## Changes

### Features

- Add optional `typescript.variableName` on products, benefits, and meters
- Use that name for generated product exports; otherwise keep the camel-cased product name plus
  `Product`
- Throw when generated exports share a name or the name is not a valid TypeScript identifier
