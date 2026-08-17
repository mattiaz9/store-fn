import type { Benefit } from "@polar-sh/sdk/models/components/benefit.js"
import type { Product } from "@polar-sh/sdk/models/components/product.js"
import type { ProductPrice } from "@polar-sh/sdk/models/components/productprice.js"
import type { ProductPriceCustom } from "@polar-sh/sdk/models/components/productpricecustom.js"
import type { ProductPriceFixed } from "@polar-sh/sdk/models/components/productpricefixed.js"
import type { ProductPriceMeteredUnit } from "@polar-sh/sdk/models/components/productpricemeteredunit.js"
import type { ProductPriceSeatBased } from "@polar-sh/sdk/models/components/productpriceseatbased.js"
import type { ProductPriceSeatTiersInput } from "@polar-sh/sdk/models/components/productpriceseattiersinput.js"
import type { ProductPriceSeatTiersOutput } from "@polar-sh/sdk/models/components/productpriceseattiersoutput.js"
import type { RecurringInterval } from "@polar-sh/sdk/models/components/recurringinterval.js"
import type { Options as PrettierOptions } from "prettier"

import type { ProductCreateDefinition } from "./types"
import { fetchPolarIterator, toCamelCase } from "./utils"

type VirtualProductDefinition = ProductCreateDefinition

export async function downloadStoreFromCloud() {
  const [products, benefits] = await Promise.all([
    fetchPolarIterator(
      globalThis.polarClient.products.list({
        organizationId: globalThis.polarOrganizationId,
      }),
    ),
    fetchPolarIterator(
      globalThis.polarClient.benefits.list({
        organizationId: globalThis.polarOrganizationId,
      }),
    ),
  ])

  return {
    products,
    benefits,
  }
}

function toSeatTiersOutput(seatTiers: ProductPriceSeatTiersInput): ProductPriceSeatTiersOutput {
  const firstTier = seatTiers.tiers[0]
  const lastTier = seatTiers.tiers[seatTiers.tiers.length - 1]

  return {
    ...seatTiers,
    minimumSeats: firstTier?.minSeats ?? 1,
    maximumSeats: lastTier?.maxSeats ?? null,
  }
}

export function resolveBenefits(
  productName: string,
  benefitKeys: string[] | undefined,
  benefitsByKey: Map<string, Benefit>,
): Benefit[] {
  if (!benefitKeys?.length) {
    return []
  }

  return benefitKeys.map((key) => {
    const benefit = benefitsByKey.get(key)
    if (!benefit) {
      throw new Error(`Unknown benefit key '${key}' on product '${productName}'`)
    }
    return benefit
  })
}

export function toProductPayload(product: ProductCreateDefinition) {
  const { virtual: _virtual, id: _id, benefits: _benefits, ...payload } = product
  return payload
}

export function mapVirtualProduct(
  { virtual: _virtual, id, benefits: benefitKeys, ...product }: VirtualProductDefinition,
  benefitsByKey: Map<string, Benefit> = new Map(),
): Product {
  const productId = id ?? String(product.metadata.key)
  return {
    ...product,
    id: productId,
    description: product.description ?? "",
    metadata: product.metadata ?? {},
    isRecurring: !!product.recurringInterval,
    attachedCustomFields: [],
    benefits: resolveBenefits(product.name, benefitKeys, benefitsByKey),
    medias: (product.medias ?? []).map((media) => ({
      id: crypto.randomUUID(),
      organizationId: "",
      name: "",
      path: media, // temp solution
      mimeType: "",
      size: 0,
      storageVersion: null,
      checksumEtag: null,
      checksumSha256Base64: null,
      checksumSha256Hex: null,
      version: null,
      service: "product_media",
      lastModifiedAt: null,
      isUploaded: false,
      createdAt: new Date(),
      sizeReadable: "0 kb",
      publicUrl: "",
    })),
    createdAt: new Date(),
    modifiedAt: null,
    organizationId: "",
    isArchived: false,
    trialInterval: null,
    trialIntervalCount: null,
    visibility: product.visibility ?? "public",
    recurringInterval: (product.recurringInterval ?? null) as RecurringInterval | null,
    recurringIntervalCount: (product.recurringIntervalCount ?? null) as number | null,
    meterInterval: "meterInterval" in product ? (product.meterInterval ?? null) : null,
    meterIntervalCount:
      "meterIntervalCount" in product ? (product.meterIntervalCount ?? null) : null,
    prices: product.prices.map((price): ProductPrice => {
      switch (price.amountType) {
        case "fixed":
          return {
            id: crypto.randomUUID(),
            amountType: price.amountType,
            priceAmount: price.priceAmount,
            priceCurrency: price.priceCurrency ?? "usd",
            taxBehavior: price.taxBehavior ?? null,
            isArchived: false,
            productId,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
          } satisfies ProductPriceFixed
        case "custom":
          return {
            id: crypto.randomUUID(),
            amountType: price.amountType,
            presetAmount: price.presetAmount ?? 0,
            minimumAmount: price.minimumAmount ?? 0,
            maximumAmount: price.maximumAmount ?? 0,
            priceCurrency: price.priceCurrency ?? "usd",
            taxBehavior: price.taxBehavior ?? null,
            productId,
            isArchived: false,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
          } satisfies ProductPriceCustom
        case "metered_unit":
          return {
            id: crypto.randomUUID(),
            amountType: price.amountType,
            capAmount: price.capAmount ?? null,
            priceCurrency: price.priceCurrency ?? "usd",
            taxBehavior: price.taxBehavior ?? null,
            meter: {
              id: crypto.randomUUID(),
              name: "usage base",
              unit: "scalar",
              customLabel: null,
              customMultiplier: null,
            },
            meterId: crypto.randomUUID(),
            productId,
            unitAmount: "1",
            isArchived: false,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
          } satisfies ProductPriceMeteredUnit
        case "seat_based":
          return {
            id: crypto.randomUUID(),
            amountType: price.amountType,
            priceCurrency: price.priceCurrency ?? "usd",
            taxBehavior: price.taxBehavior ?? null,
            seatTiers: toSeatTiersOutput(price.seatTiers),
            productId,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
            isArchived: false,
          } satisfies ProductPriceSeatBased
      }
    }),
  } satisfies Product
}

function formatProduct(product: Product) {
  const parsedJson = JSON.stringify(product, null, 2)
    // initialize timestmaps
    .replace(/"(\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d.\d\d\dZ)"/g, (val) => `new Date(${val})`)
  return `export const ${toCamelCase(
    product.name,
  )}Product = ${parsedJson} as const satisfies Product`
}

export async function writeProductsToFile(products: Product[], path: string) {
  if (typeof window !== "undefined") {
    throw new Error("writeProductsToFile is not supported in the browser")
  }

  let storeProductsFileContent = `
import type { Product } from "@polar-sh/sdk/models/components/product.js"

${products.map(formatProduct).join("\n\n")}
`

  const writeFile = await import("fs/promises").then((m) => m.writeFile)
  const prettier = await import("prettier").then((m) => m.default).catch(() => null)

  if (prettier) {
    const path = await import("path").then((m) => m.default)
    const existsSync = await import("fs").then((m) => m.existsSync)
    const basePath = path.dirname(path.resolve(import.meta.url))
    const prettierConfigs = ["prettier.config.js", "prettier.config.ts"].map((config) =>
      path.resolve(basePath, config),
    )
    const prettierConfigPath = prettierConfigs.find((config) => existsSync(config))
    const prettierConfig: PrettierOptions | null = prettierConfigPath
      ? await import(prettierConfigPath)
          .then((m: { default?: PrettierOptions }) => m.default ?? null)
          .catch((): null => null)
      : null

    storeProductsFileContent = await prettier.format(storeProductsFileContent.trim(), {
      parser: "typescript",
      ...prettierConfig,
    })
  }

  await writeFile(path, storeProductsFileContent)
}
