# Tests / Manual checks

This repository currently contains a lightweight manual serialization check you can run with Node (no additional test frameworks required).

## Serialization check (areas)

This script will import the `FloorPlan` model, create a floorplan with a coordinate-based area, serialize it with `toJSON`, then deserialize with `fromJSON` and assert the area survived.

Run it from the repo root:

```bash
node scripts/serialization-check.js
```

Expected output:

```
Serialization check passed.
```

If the script exits with a non-zero code, inspect the printed error.

## Notes

- The project does not currently use Jest or other test frameworks to avoid changing package type or adding dev dependencies in this prototype state.
- If you'd like I can add a Jest-based test harness and update `package.json` with the required `devDependencies` and scripts.
