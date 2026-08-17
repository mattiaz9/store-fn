## Changes

### Features

- Add `defineMeter` and sync Polar meters by `metadata.key` on `push()`
- Let metered prices and `meter_credit` benefits reference a meter by store-fn key
- Convert metered `unitAmount` and `capAmount` from dollars

### Breaking changes

- Metered prices use `meter` (store-fn key) instead of Polar `meterId`
- `meter_credit` benefits use `properties.meter` instead of `properties.meterId`

### Fixes

- Virtual metered products resolve the synced Polar meter instead of a random stub
