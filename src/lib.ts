import { fetchPolarIterator, toCamelCase } from "./utils"
import { Product } from "@polar-sh/sdk/models/components/product.js"
import { ProductPriceSeatBased } from "@polar-sh/sdk/models/components/productpriceseatbased.js"
import { ProductPriceMeteredUnit } from "@polar-sh/sdk/models/components/productpricemeteredunit.js"
import { ProductPriceCustom } from "@polar-sh/sdk/models/components/productpricecustom.js"
import { ProductPriceFixed } from "@polar-sh/sdk/models/components/productpricefixed.js"
import { ProductPriceFree } from "@polar-sh/sdk/models/components/productpricefree.js"
import { SubscriptionRecurringInterval } from "@polar-sh/sdk/models/components/subscriptionrecurringinterval.js"
import { ProductCreateDefinition } from "./types"

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

export function mapVirtualProduct({ virtual, ...product }: ProductCreateDefinition<any>): Product {
  const productId = product.metadata.key as string
  return {
    id: productId,
    ...product,
    description: product.description ?? "",
    metadata: product.metadata ?? {},
    isRecurring: !!product.recurringInterval,
    attachedCustomFields: [],
    benefits: [],
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
    recurringInterval: (product.recurringInterval ?? null) as SubscriptionRecurringInterval | null,
    recurringIntervalCount: (product.recurringIntervalCount ?? null) as number | null,
    prices: product.prices.map((price) => {
      switch (price.amountType) {
        case "free":
          return {
            id: crypto.randomUUID(),
            type: product.recurringInterval ? "recurring" : "one_time",
            recurringInterval: null,
            amountType: "free",
            isArchived: false,
            productId,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
          } satisfies ProductPriceFree
        case "fixed":
          return {
            id: crypto.randomUUID(),
            type: product.recurringInterval ? "recurring" : "one_time",
            recurringInterval: null,
            amountType: price.amountType,
            priceAmount: price.priceAmount,
            priceCurrency: price.priceCurrency ?? "usd",
            isArchived: false,
            productId,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
          } satisfies ProductPriceFixed
        case "custom":
          return {
            id: crypto.randomUUID(),
            type: product.recurringInterval ? "recurring" : "one_time",
            recurringInterval: null,
            amountType: price.amountType,
            presetAmount: price.presetAmount ?? 0,
            minimumAmount: price.minimumAmount ?? 0,
            maximumAmount: price.maximumAmount ?? 0,
            priceCurrency: price.priceCurrency ?? "usd",
            productId,
            isArchived: false,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
          } satisfies ProductPriceCustom
        case "metered_unit":
          return {
            id: crypto.randomUUID(),
            type: product.recurringInterval ? "recurring" : "one_time",
            recurringInterval: null,
            amountType: price.amountType,
            capAmount: price.capAmount ?? null,
            priceCurrency: price.priceCurrency ?? "usd",
            meter: {
              id: crypto.randomUUID(),
              name: "usage base",
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
            type: product.recurringInterval ? "recurring" : "one_time",
            recurringInterval: null,
            amountType: price.amountType,
            priceCurrency: price.priceCurrency ?? "usd",
            seatTiers: price.seatTiers,
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
    const prettierConfig = prettierConfigPath
      ? await import(prettierConfigPath).then((m) => m.default).catch(() => null)
      : null

    storeProductsFileContent = await prettier.format(storeProductsFileContent.trim(), {
      parser: "typescript",
      ...prettierConfig,
    })
  }

  await writeFile(path, storeProductsFileContent)
}
