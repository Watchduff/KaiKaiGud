import "dotenv/config";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  throw new Error("Set DATABASE_URL in a private environment variable before migrating.");
}

const sourcePath = resolve(process.env.DATABASE_PATH || "data/orders.db");
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
const migrationId = "local-sqlite-to-neon-v1";

try {
  const menuItems = source.prepare("SELECT id, name, description, category, price_cents, emoji, available FROM menu_items").all();
  const orderColumns = new Set(source.pragma("table_info(orders)").map((column) => column.name));
  const itemColumns = new Set(source.pragma("table_info(order_items)").map((column) => column.name));
  const orders = source.prepare("SELECT * FROM orders ORDER BY created_at, id").all();
  const orderItems = source.prepare("SELECT * FROM order_items ORDER BY id").all();
  const legacyOrders = orders.map((order) => ({
    ...order,
    service_type: orderColumns.has("service_type") ? order.service_type : "dine_in",
  }));
  const legacyItems = orderItems.map((item) => ({
    ...item,
    preferences: itemColumns.has("preferences") ? item.preferences : "",
  }));
  const itemsByOrder = new Map();
  for (const item of legacyItems) {
    const items = itemsByOrder.get(item.order_id) || [];
    items.push(item);
    itemsByOrder.set(item.order_id, items);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_data_migrations (
        id TEXT PRIMARY KEY,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const alreadyMigrated = await client.query("SELECT 1 FROM app_data_migrations WHERE id = $1", [migrationId]);
    if (alreadyMigrated.rowCount) {
      await client.query("ROLLBACK");
      console.log("The local SQLite database was already copied to Neon; no rows were changed.");
    } else {
      for (const item of menuItems) {
        await client.query(`
          INSERT INTO menu_items (id, name, description, category, price_cents, emoji, available)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            price_cents = EXCLUDED.price_cents,
            emoji = EXCLUDED.emoji,
            available = EXCLUDED.available
        `, [item.id, item.name, item.description, item.category, item.price_cents, item.emoji, Boolean(item.available)]);
      }

      for (const order of legacyOrders) {
        const inserted = await client.query(`
          INSERT INTO orders (id, receipt_token_hash, table_number, service_type, status, payment_status, total_cents, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING
        `, [order.id, order.receipt_token_hash, order.table_number, order.service_type, order.status,
          order.payment_status, order.total_cents, order.created_at]);
        if (inserted.rowCount === 0) continue;

        for (const item of itemsByOrder.get(order.id) || []) {
          await client.query(`
            INSERT INTO order_items (id, order_id, menu_item_id, name, quantity, price_cents, preferences)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
          `, [item.id, item.order_id, item.menu_item_id, item.name, item.quantity, item.price_cents, item.preferences]);
        }
      }

      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('order_items', 'id'),
          COALESCE(MAX(id), 1),
          MAX(id) IS NOT NULL
        )
        FROM order_items
      `);
      await client.query("INSERT INTO app_data_migrations (id) VALUES ($1)", [migrationId]);
      await client.query("COMMIT");
      console.log(`Copied ${menuItems.length} menu item(s), ${legacyOrders.length} order(s), and ${legacyItems.length} order line(s) to Neon.`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  source.close();
  await pool.end();
}
