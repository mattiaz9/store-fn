## Changes

### Features

- Add `defineBenefit` and attach Polar benefits to products by key on `push()`

### Breaking changes

- `push()` now replaces Polar dashboard benefit attachments for every non-virtual product in the store config. Omitted `benefits` means an empty list.

### Fixes

- Keep Polar benefit create/update unions discriminated and map custom `note` on update
