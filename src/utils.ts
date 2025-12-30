import { Pagination } from "@polar-sh/sdk/models/components/pagination.js"
import { Product } from "@polar-sh/sdk/models/components/product.js"
import { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js"
import { PageIterator } from "@polar-sh/sdk/types/operations.js"

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
  >
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

function nonStrictDeepEqual(a: any, b: any): boolean {
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

  if (Array.isArray(a)) {
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

  if (typeof a === "object") {
    for (const key in a) {
      let aVal = a[key]

      // patch priceAmount
      if (key === "priceAmount") {
        aVal = Math.round(a[key] * 100)
      }

      if (!nonStrictDeepEqual(aVal, b[key])) {
        return false
      }
    }

    return true
  }

  if (a !== b) {
    return false
  }

  return true
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
