# SQL-First Migrations

Plain `.sql` files, applied in filename order. Numbering follows the dependency-sorted
creation waves of `../../10_Data_Model/physical_schema_design.md` §2 (DEC-011: SQL-first
because the schema's append-only triggers, partitions, and outbox don't survive ORM
abstraction).

Convention: `NNNN_waveW_<scope>.sql` — e.g. `0001_wave1_foundation.sql`,
`0002_wave1_platform.sql`, `0010_wave2_customers_catalog.sql` …

**Empty by design at WP-00.** Wave-1 DDL + seeds (roles, permissions, transition_config,
settings registry, reason-code domains) land with WP-01. Dormant-module tables are never
created (mvp_architecture_cut.md §2).
