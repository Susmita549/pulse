import type { Brand, Wave } from "@prisma/client";

import { EMPTY_SUMMARY, type Summary } from "@/lib/nps";
import { prisma } from "@/lib/prisma";
import { ResponseService } from "@/services/response.service";

export type BrandWithStats = Brand & {
  waveCount: number;
  latestWave: Wave | null;
  summary: Summary;
  customerCount: number;
  activeCustomers: number;
};

export class BrandService {
  static async list(): Promise<Brand[]> {
    return prisma.brand.findMany({ orderBy: { name: "asc" } });
  }

  static async getBySlug(slug: string): Promise<Brand | null> {
    return prisma.brand.findUnique({ where: { slug } });
  }

  /**
   * Brand list with the headline number for each brand's most recent wave.
   */
  static async listWithStats(): Promise<BrandWithStats[]> {
    const brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
    if (brands.length === 0) return [];

    const brandIds = brands.map((brand) => brand.id);

    const [waves, customerCounts, activeCounts] = await Promise.all([
      prisma.wave.findMany({
        where: { brandId: { in: brandIds } },
        orderBy: { startDate: "desc" },
      }),
      prisma.customer.groupBy({
        by: ["brandId"],
        where: { brandId: { in: brandIds } },
        _count: { _all: true },
      }),
      prisma.customer.groupBy({
        by: ["brandId"],
        where: { brandId: { in: brandIds }, responses: { some: {} } },
        _count: { _all: true },
      }),
    ]);

    const wavesByBrand = new Map<string, Wave[]>();
    for (const wave of waves) {
      const list = wavesByBrand.get(wave.brandId) ?? [];
      list.push(wave);
      wavesByBrand.set(wave.brandId, list);
    }

    const customerCountByBrand = new Map(
      customerCounts.map((row) => [row.brandId, row._count._all]),
    );
    const activeCountByBrand = new Map(
      activeCounts.map((row) => [row.brandId, row._count._all]),
    );

    const latestWaves = brands.map((brand) => wavesByBrand.get(brand.id)?.[0] ?? null);
    const summaries = await Promise.all(
      latestWaves.map((wave) => (wave ? ResponseService.getSummary(wave) : Promise.resolve(EMPTY_SUMMARY))),
    );

    return brands.map((brand, index) => {
      const brandWaves = wavesByBrand.get(brand.id) ?? [];
      const latestWave = latestWaves[index];

      return {
        ...brand,
        waveCount: brandWaves.length,
        latestWave,
        summary: summaries[index],
        customerCount: customerCountByBrand.get(brand.id) ?? 0,
        activeCustomers: activeCountByBrand.get(brand.id) ?? 0,
      };
    });
  }
}
