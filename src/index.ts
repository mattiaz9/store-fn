import pc from "picocolors"

import {
  downloadStoreFromCloud,
  mapVirtualProduct,
  resolveBenefits,
  toBenefitPayload,
  toProductPayload,
  writeProductsToFile,
} from "./lib"

import type {
  BenefitCreateDefinition,
  BenefitDefinition,
  MeterCreateDefinition,
  MeterDefinition,
  ProductCreateDefinition,
  ProductDefinition,
  StoreMetadata,
} from "./types"
import type { Polar } from "@polar-sh/sdk"
import type { Benefit } from "@polar-sh/sdk/models/components/benefit.js"
import type { Meter } from "@polar-sh/sdk/models/components/meter.js"
import type { Product } from "@polar-sh/sdk/models/components/product.js"

interface CreateStoreFnOptions {
  client: Polar
  organizationId: string
}

function createStoreFn(options: CreateStoreFnOptions) {
  const definedProducts: ProductCreateDefinition[] = []
  const definedBenefits: BenefitCreateDefinition[] = []
  const definedMeters: MeterCreateDefinition[] = []

  function defineProduct<TMeta extends StoreMetadata = StoreMetadata>({
    key,
    ...details
  }: ProductDefinition<TMeta>) {
    details.prices = details.prices.map((price) => {
      if ("priceAmount" in price) {
        price.priceAmount = Math.round(price.priceAmount * 100)
      }
      if ("presetAmount" in price && typeof price.presetAmount === "number") {
        price.presetAmount = Math.round(price.presetAmount * 100)
      }
      if ("minimumAmount" in price && typeof price.minimumAmount === "number") {
        price.minimumAmount = Math.round(price.minimumAmount * 100)
      }
      if ("maximumAmount" in price && typeof price.maximumAmount === "number") {
        price.maximumAmount = Math.round(price.maximumAmount * 100)
      }
      if ("unitAmount" in price && typeof price.unitAmount === "number") {
        price.unitAmount = Number((price.unitAmount * 100).toFixed(12))
      }
      if ("capAmount" in price && typeof price.capAmount === "number") {
        price.capAmount = Math.round(price.capAmount * 100)
      }
      return price
    })

    const definition = {
      ...details,
      metadata: {
        key,
        ...details.metadata,
      } as TMeta & { key: string },
    } satisfies ProductCreateDefinition<TMeta>

    definedProducts.push(definition)

    return definition
  }

  function defineBenefit<TMeta extends StoreMetadata = StoreMetadata>({
    key,
    ...details
  }: BenefitDefinition<TMeta>) {
    const definition = {
      ...details,
      metadata: {
        key,
        ...details.metadata,
      } as TMeta & { key: string },
    } satisfies BenefitCreateDefinition<TMeta>

    definedBenefits.push(definition)

    return definition
  }

  function defineMeter<TMeta extends StoreMetadata = StoreMetadata>({
    key,
    ...details
  }: MeterDefinition<TMeta>) {
    const definition = {
      ...details,
      metadata: {
        key,
        ...details.metadata,
      } as TMeta & { key: string },
    } satisfies MeterCreateDefinition<TMeta>

    definedMeters.push(definition)

    return definition
  }

  async function push() {
    globalThis.polarClient = options.client
    globalThis.polarOrganizationId = options.organizationId

    const polarStore = await downloadStoreFromCloud()

    const metersByKey = new Map<string, Meter>()

    for (const meter of definedMeters) {
      if (!meter.metadata?.key) {
        throw new Error(`Missing 'key' in meter ${meter.name}`)
      }

      const existingMeter = polarStore.meters.find(
        (item) => item.metadata.key === meter.metadata.key,
      )
      const { organizationId: _organizationId, ...meterPayload } = meter

      const upsertedMeter = existingMeter
        ? await polarClient.meters.update({
            id: existingMeter.id,
            meterUpdate: meterPayload,
          })
        : await polarClient.meters.create(meterPayload)

      metersByKey.set(meter.metadata.key, upsertedMeter)

      if (existingMeter) {
        console.log(pc.green(`Updated meter '${pc.bold(meter.name)}'`))
      } else {
        console.log(pc.cyan(`Created new meter '${pc.bold(meter.name)}'`))
      }
    }

    const benefitsByKey = new Map<string, Benefit>()

    for (const benefit of definedBenefits) {
      if (!benefit.metadata?.key) {
        throw new Error(`Missing 'key' in benefit ${benefit.description}`)
      }

      const existingBenefit = polarStore.benefits.find(
        (item) => item.metadata.key === benefit.metadata.key,
      )
      const benefitPayload = toBenefitPayload(benefit, metersByKey)

      if (existingBenefit) {
        const { organizationId: _organizationId, ...requestBody } = benefitPayload
        const updatedBenefit = await polarClient.benefits.update({
          id: existingBenefit.id,
          requestBody:
            requestBody.type === "custom"
              ? {
                  ...requestBody,
                  properties: { note: requestBody.properties.note ?? null },
                }
              : requestBody,
        })
        benefitsByKey.set(benefit.metadata.key, updatedBenefit)

        console.log(pc.green(`Updated benefit '${pc.bold(benefit.description)}'`))
      } else {
        const createdBenefit = await polarClient.benefits.create(benefitPayload)
        benefitsByKey.set(benefit.metadata.key, createdBenefit)

        console.log(pc.cyan(`Created new benefit '${pc.bold(benefit.description)}'`))
      }
    }

    for (const product of definedProducts) {
      resolveBenefits(product.name, product.benefits, benefitsByKey)
    }

    const updatedProducts: Product[] = []

    for (const product of definedProducts) {
      if (!product.metadata?.key) {
        throw new Error(`Missing 'key' in product ${product.name}`)
      }

      if (product.virtual) {
        const virtualProduct = mapVirtualProduct(product, benefitsByKey, metersByKey)
        updatedProducts.push(virtualProduct)
        continue
      }

      const existingProduct = polarStore.products.find(
        (p) => p.metadata.key === product.metadata?.key,
      )

      const productPayload = toProductPayload(product, metersByKey)

      const upsertedProduct = existingProduct
        ? await polarClient.products.update({
            id: existingProduct.id,
            productUpdate: productPayload,
          })
        : await polarClient.products.create(productPayload)

      if (existingProduct) {
        console.log(pc.green(`Updated product '${pc.bold(product.name)}'`))
      } else {
        console.log(pc.cyan(`Created new product '${pc.bold(product.name)}'`))
      }

      const attached = resolveBenefits(product.name, product.benefits, benefitsByKey)
      const productWithBenefits = await polarClient.products.updateBenefits({
        id: upsertedProduct.id,
        productBenefitsUpdate: {
          benefits: attached.map((benefit) => benefit.id),
        },
      })
      updatedProducts.push(productWithBenefits)
    }

    // @ts-expect-error -- clear client after sync completes
    globalThis.polarClient = undefined
    // @ts-expect-error -- clear organization after sync completes
    globalThis.polarOrganizationId = undefined

    return {
      updatedProducts,
    }
  }

  return { defineProduct, defineBenefit, defineMeter, push }
}

export type {
  BenefitCreateDefinition,
  BenefitDefinition,
  MeterCreateDefinition,
  MeterDefinition,
  ProductCreateDefinition,
  ProductDefinition,
  StoreMetadata,
}
export { createStoreFn, writeProductsToFile }
