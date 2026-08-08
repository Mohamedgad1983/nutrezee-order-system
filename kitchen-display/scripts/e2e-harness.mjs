import { resolve } from 'node:path';
import { AuthManager, createPasswordHash } from '../dist/api/api/auth.js';
import { createKdsServer } from '../dist/api/api/server.js';

const origin = 'http://127.0.0.1:4190';
const hot = { sectionId: 'hot-id', code: 'hot', nameEn: 'Hot Kitchen', nameAr: 'المطبخ الساخن', stepNo: 1, isPacking: false };
const packing = { sectionId: 'packing-id', code: 'packing', nameEn: 'Packing', nameAr: 'التجهيز', stepNo: 9, isPacking: true };
const source = {
  async itemsForDay() {
    return {
      serverTime: '2026-08-08T10:00:00+03:00',
      items: [
        { itemRef: 'PRIVATE-ROW-1', mealId: 'meal-chicken', nameEn: 'Grilled Chicken', nameAr: 'دجاج مشوي', portionSize: 'large', quantity: 2, sections: [hot, packing] },
        { itemRef: 'PRIVATE-ROW-2', mealId: 'meal-chicken', nameEn: 'Grilled Chicken', nameAr: 'دجاج مشوي', portionSize: 'large', quantity: 3, sections: [hot] },
        { itemRef: 'PRIVATE-ROW-3', mealId: 'meal-soup', nameEn: 'Vegetable Soup', nameAr: 'شوربة خضار', portionSize: 'regular', quantity: 4, sections: [] },
      ],
    };
  },
};

const auth = new AuthManager({
  username: 'kitchen-display',
  passwordHash: await createPasswordHash('e2e-only-password', Buffer.alloc(16, 9)),
});
const server = createKdsServer({
  auth,
  source,
  kitchens: ['main'],
  publicOrigin: origin,
  secureCookies: false,
  webRoot: resolve('dist/web'),
  refreshSeconds: 60,
  logger: () => undefined,
});
server.listen(4190, '127.0.0.1');

const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
