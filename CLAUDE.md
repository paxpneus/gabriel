# Architecture rules

## Layer separation: repository / service / controller

This codebase's modules follow the `BaseRepository` / `BaseService` / `BaseController`
pattern (see `src/shared/utils/base-models/`). Each layer only talks to its own
layer in other entities — never reaches past it:

- **Repository** talks only to its own Sequelize model. If it needs data from
  another entity and it's not a plain `include`, it must go through that
  other entity's **repository** — never call another entity's model
  directly from a repository.
- **Service** contains business rules and orchestration. If it needs another
  entity, it calls that entity's **service** (e.g. `productConfigService`,
  `supplierMappingService`) — never that entity's model or repository
  directly.
- **Controller** only handles request/response (params, auth context,
  status codes) and delegates to its own service.

`include` in a Sequelize query (eager-loading a relation as part of one
query) is fine at any layer that already queries its own model — that's not
"calling another entity," it's a join. But a *separate* query against another
entity's model (e.g. `ProductConfig.findOne(...)` or
`SupplierMapping.findOne(...)` from inside `ProductService`) is a layering
violation, even if the result is only read, never written.

Before adding a method that needs another entity's data, check
`BaseRepository`/`BaseService`/`BaseController` first — most generic
lookups (`findOne`, `findById`, `findAll`, etc.) are already there, so the
correct fix is usually calling `<entity>Service.findOne(...)`, not writing a
new raw query.
