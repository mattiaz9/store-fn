import type { Pagination } from "@polar-sh/sdk/models/components/pagination.js"
import type { Product } from "@polar-sh/sdk/models/components/product.js"
import type { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js"
import type { PageIterator } from "@polar-sh/sdk/types/operations.js"

export async function fetchPolarIterator<T>(
  iterator: Promise<
    PageIterator<
      {
        result: {
          items: Array<T>
          pagination: Pagination
        }
      },
      { page: number }
    >
  >,
) {
  const items: T[] = []

  const result = await iterator

  for await (const page of result) {
    items.push(...page.result.items)
  }

  return items
}

export function productMatchesProductCreate(product: Product, productCreate: ProductCreate) {
  return nonStrictDeepEqual(productCreate, product)
}

export function nonStrictDeepEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && typeof b === "string") {
    return a.toISOString() === b
  }
  if (b instanceof Date && typeof a === "string") {
    return b.toISOString() === a
  }

  if (typeof a !== typeof b) {
    return false
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false
    }

    for (let i = 0; i < a.length; i++) {
      if (!nonStrictDeepEqual(a[i], b[i])) {
        return false
      }
    }

    return true
  }

  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>

    for (const key of Object.keys(aObj)) {
      let aVal = aObj[key]

      // patch priceAmount
      if (key === "priceAmount" && typeof aVal === "number") {
        aVal = Math.round(aVal * 100)
      }

      if (!nonStrictDeepEqual(aVal, bObj[key])) {
        return false
      }
    }

    return true
  }

  return a === b
}

export function toCamelCase(str: string) {
  if (!str) return str

  return str
    .split(/[\s-_]+/)
    .map((word, index) => {
      // Convert to lowercase first
      word = word.toLowerCase()
      // Capitalize all words except the first one
      if (index > 0) {
        return word.charAt(0).toUpperCase() + word.slice(1)
      }
      return word
    })
    .join("")
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack
  }
  return undefined
}

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error
    return typeof code === "string" ? code : undefined
  }
  return undefined
}
