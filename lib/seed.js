// CLI seeder: writes a fresh sample dataset to the local data file.
import { resetWith } from './store.js';
import { buildSeed } from './seedData.js';

const seed = buildSeed();
resetWith(seed);
console.log(`Seeded ${seed.tickets.length} tickets into the data store`);
