import "dotenv/config";
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import pg from "pg";
import QRCode from "qrcode";

const port = Number(process.env.PORT || 3000);
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminUsername || !adminPassword || adminPassword.length < 12) {
  throw new Error("Set ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters in .env.");
}

const staticFiles = new Map([
  ["/", ["public/index.html", "text/html; charset=utf-8"]],
  ["/kaikaigud-logo.png", ["public/kaikaigud-logo.png", "image/png"]],
  ["/favicon.svg", ["public/favicon.svg", "image/svg+xml"]],
  ["/styles.css", ["public/styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["public/app.js", "text/javascript; charset=utf-8"]],
]);
const databasePath = resolve(process.env.DATABASE_PATH || "data/orders.db");
const usePostgres = Boolean(process.env.DATABASE_URL);

function createPostgresDatabase() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  function adapter(query) {
    return {
      exec: async (sql) => query(sql),
      hasColumn: async (table, column) => {
        const result = await query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2",
          [table, column],
        );
        return result.rowCount > 0;
      },
      prepare(sql) {
        const ignoreConflicts = /^\s*INSERT OR IGNORE INTO/i.test(sql);
        let parameterIndex = 0;
        const normalizedSql = sql.replace(/INSERT OR IGNORE INTO/i, "INSERT INTO")
          .replace(/\?/g, () => `$${++parameterIndex}`)
          .trim().replace(/;$/, "");
        const statementSql = ignoreConflicts ? `${normalizedSql} ON CONFLICT DO NOTHING` : normalizedSql;
        return {
          all: async (...params) => (await query(statementSql, params)).rows,
          get: async (...params) => (await query(statementSql, params)).rows[0],
          run: async (...params) => query(statementSql, params),
        };
      },
      async transaction(statements) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const statement of statements) {
            await adapter((sql, params) => client.query(sql, params)).prepare(statement.sql).run(...statement.params);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }
  return Object.assign(adapter((sql, params) => pool.query(sql, params)), { close: () => pool.end() });
}

function createSqliteDatabase() {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const adapter = {
    exec: (sql) => sqlite.exec(sql),
    hasColumn: (table, column) => sqlite.pragma(`table_info(${table})`).some((entry) => entry.name === column),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        all: (...params) => statement.all(...params),
        get: (...params) => statement.get(...params),
        run: (...params) => statement.run(...params),
      };
    },
    transaction(statements) {
      return sqlite.transaction(() => {
        for (const statement of statements) {
          sqlite.prepare(statement.sql).run(...statement.params);
        }
      })();
    },
    close: () => sqlite.close(),
  };
  return adapter;
}

const db = usePostgres ? createPostgresDatabase() : createSqliteDatabase();

if (usePostgres) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      emoji TEXT NOT NULL,
      available BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      receipt_token_hash TEXT NOT NULL,
      table_number TEXT NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'dine_in',
      status TEXT NOT NULL DEFAULT 'queued',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      menu_item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      preferences TEXT NOT NULL DEFAULT ''
    );
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'dine_in';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS preferences TEXT NOT NULL DEFAULT '';
  `);
} else {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      emoji TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      receipt_token_hash TEXT NOT NULL,
      table_number TEXT NOT NULL,
      service_type TEXT NOT NULL DEFAULT 'dine_in',
      status TEXT NOT NULL DEFAULT 'queued',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      menu_item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      preferences TEXT NOT NULL DEFAULT ''
    );
  `);
}
if (!await db.hasColumn("orders", "service_type")) {
  await db.exec("ALTER TABLE orders ADD COLUMN service_type TEXT NOT NULL DEFAULT 'dine_in'");
}
if (!await db.hasColumn("order_items", "preferences")) {
  await db.exec("ALTER TABLE order_items ADD COLUMN preferences TEXT NOT NULL DEFAULT ''");
}

const starterItems = [
  ["grilled-chicken-bowl", "Grilled chicken bowl", "Citrus chicken, rice, greens, and herby dressing.", "Meals", 180000, "🍗"],
  ["crispy-fish-tacos", "Crispy fish tacos", "Two crunchy tacos with slaw and lime crema.", "Meals", 160000, "🌮"],
  ["veggie-noodle-bowl", "Veggie noodle bowl", "Sesame noodles with seasonal vegetables.", "Meals", 150000, "🍜"],
  ["garden-salad", "Garden salad", "Fresh greens, tomato, cucumber, and house vinaigrette.", "Meals", 120000, "🥗"],
  ["iced-tea", "Coke", "Chilled Coca-Cola.", "Beverages", 25000, "🥤"],
  ["lemonade", "Sprite", "Chilled lemon-lime soda.", "Beverages", 25000, "🥤"],
  ["fanta", "Fanta", "Chilled orange soda.", "Beverages", 25000, "🥤"],
  ["chocolate-brownie", "Chocolate brownie", "Warm brownie with a soft center.", "Desserts", 60000, "🍫"],
  ["fruit-cup", "Seasonal fruit cup", "A chilled mix of today's fresh fruit.", "Desserts", 50000, "🍓"],
];
const legacyStarterItems = [
  {
    id: "grilled-chicken-bowl",
    newName: "Grilled chicken bowl",
    newDescription: "Citrus chicken, rice, greens, and herby dressing.",
    newPrice: 1800,
    legacy: [["Grilled chicken bowl", "Citrus chicken, rice, greens, and herby dressing.", 1450], ["Bole blong raes wetem faol", "Faol we oli grilim wetem sitrus, raes, grin lif mo dresing blong lif.", 1450]],
  },
  {
    id: "crispy-fish-tacos",
    newName: "Crispy fish tacos",
    newDescription: "Two crunchy tacos with slaw and lime crema.",
    newPrice: 1600,
    legacy: [["Crispy fish tacos", "Two crunchy tacos with slaw and lime crema.", 1280], ["Tako blong fis we i krispi", "Tu tako wetem fis, kabij mo swit krem blong laem.", 1280]],
  },
  {
    id: "veggie-noodle-bowl",
    newName: "Veggie noodle bowl",
    newDescription: "Sesame noodles with seasonal vegetables.",
    newPrice: 1500,
    legacy: [["Veggie noodle bowl", "Sesame noodles with seasonal vegetables.", 1190], ["Nudel wetem vejtebol", "Nudel wetem seesem mo ol vejtebol blong taem ia.", 1190]],
  },
  {
    id: "garden-salad",
    newName: "Garden salad",
    newDescription: "Fresh greens, tomato, cucumber, and house vinaigrette.",
    newPrice: 1200,
    legacy: [["Garden salad", "Fresh greens, tomato, cucumber, and house vinaigrette.", 950], ["Salad blong garen", "Grin lif, tomato, kukamba mo sos blong salad.", 950]],
  },
  {
    id: "iced-tea",
    newName: "Coke",
    newDescription: "Chilled Coca-Cola.",
    newPrice: 250,
    newEmoji: "🥤",
    legacyEmoji: "🧋",
    legacy: [["House iced tea", "Freshly brewed, lightly sweetened.", 350], ["Aes ti blong haos", "Ti we oli mekem niu mo i gat smol suga nomo.", 350], ["Coke", "Chilled Coca-Cola.", 250]],
  },
  {
    id: "lemonade",
    newName: "Sprite",
    newDescription: "Chilled lemon-lime soda.",
    newPrice: 250,
    newEmoji: "🥤",
    legacyEmoji: "🍋",
    legacy: [["Sparkling lemonade", "Bright lemon with a little fizz.", 425], ["Lemonad we i gat gas", "Fres lemonad we i gat smol gas long hem.", 425], ["Sprite", "Chilled lemon-lime soda.", 250]],
  },
  {
    id: "fanta",
    newName: "Fanta",
    newDescription: "Chilled orange soda.",
    newPrice: 250,
    legacy: [["Fanta", "Chilled orange soda.", 250]],
  },
  {
    id: "chocolate-brownie",
    newName: "Chocolate brownie",
    newDescription: "Warm brownie with a soft center.",
    newPrice: 600,
    legacy: [["Chocolate brownie", "Warm brownie with a soft center.", 550], ["Browni blong choklet", "Browni blong choklet we oli womem mo i sofsof insaed.", 550]],
  },
  {
    id: "fruit-cup",
    newName: "Seasonal fruit cup",
    newDescription: "A chilled mix of today's fresh fruit.",
    newPrice: 500,
    legacy: [["Seasonal fruit cup", "A chilled mix of today's fresh fruit.", 475], ["Kap blong frut blong taem ia", "Ol fres frut blong taem ia we oli mekem i kolkol.", 475]],
  },
];
const insertMenuItem = db.prepare(`
  INSERT OR IGNORE INTO menu_items (id, name, description, category, price_cents, emoji)
  VALUES (?, ?, ?, ?, ?, ?)
`);
for (const item of starterItems) await insertMenuItem.run(...item);
const updateUneditedStarter = db.prepare(`
  UPDATE menu_items
  SET name = ?,
      description = ?,
      price_cents = CASE WHEN ? IS NOT NULL AND price_cents = ? THEN ? ELSE price_cents END,
      emoji = CASE WHEN ? IS NOT NULL AND emoji = ? THEN ? ELSE emoji END
  WHERE id = ? AND name = ? AND description = ?
`);
for (const item of legacyStarterItems) {
  for (const [oldName, oldDescription, oldPrice] of item.legacy) {
    await updateUneditedStarter.run(item.newName, item.newDescription, item.newPrice == null ? null : item.newPrice * 100, oldPrice ?? null,
      item.newPrice == null ? null : item.newPrice * 100,
      item.newEmoji ?? null, item.legacyEmoji ?? null, item.newEmoji ?? null, item.id, oldName, oldDescription);
  }
}
const updateUneditedStarterEmoji = db.prepare(`
  UPDATE menu_items SET emoji = ?
  WHERE id = ? AND name = ? AND description = ? AND emoji = ?
`);
for (const item of legacyStarterItems.filter((starter) => starter.newEmoji && starter.legacyEmoji)) {
  await updateUneditedStarterEmoji.run(item.newEmoji, item.id, item.newName, item.newDescription, item.legacyEmoji);
}
const updateUneditedVatuPrice = db.prepare(`
  UPDATE menu_items SET price_cents = ?
  WHERE id = ? AND name = ? AND description = ? AND price_cents = ?
`);
for (const item of legacyStarterItems.filter((starter) => starter.newPrice != null)) {
  const seedItem = starterItems.find(([id]) => id === item.id);
  const seededVatuSubunits = seedItem[4];
  const currentSeedPrices = new Set(item.legacy.flatMap(([, , oldPrice]) => [oldPrice, oldPrice * 100]));
  for (const oldPrice of currentSeedPrices) {
    if (oldPrice == null) continue;
    await updateUneditedVatuPrice.run(seededVatuSubunits, item.id, item.newName, item.newDescription, oldPrice);
  }
}

const sessions = new Map();
const loginAttempts = new Map();
const sessionDurationMs = 12 * 60 * 60 * 1000;
const loginSalt = randomBytes(16);
const expectedPasswordHash = scryptSync(adminPassword, loginSalt, 64);
const expectedUsernameHash = createHash("sha256").update(adminUsername).digest();

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 32_768) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function cookieValue(request, name) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : "";
}

function authenticated(request) {
  const id = cookieValue(request, "restaurant_staff");
  const expiresAt = sessions.get(id);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(id);
    return false;
  }
  sessions.set(id, Date.now() + sessionDurationMs);
  return true;
}

function requireStaff(request, response) {
  if (authenticated(request)) return true;
  sendJson(response, 401, { error: "Staff sign-in required." });
  return false;
}

function secureCookie() {
  return process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
}

function checkLoginLimit(ip) {
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt <= Date.now()) {
    loginAttempts.set(ip, { count: 0, resetAt: Date.now() + 15 * 60 * 1000 });
    return loginAttempts.get(ip);
  }
  return current;
}

async function orderDetails(id) {
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return null;
  const items = await db.prepare(`
    SELECT menu_item_id AS id, name, quantity, price_cents, preferences
    FROM order_items WHERE order_id = ? ORDER BY id
  `).all(id);
  return { ...order, items };
}

async function handleApi(request, response, url) {
  const { method } = request;
  const path = url.pathname;

  if (method === "GET" && path === "/api/menu") {
    const items = (await db.prepare(`
      SELECT id, name, description, category, price_cents, emoji, available
      FROM menu_items ORDER BY category, name
    `).all()).map((item) => ({ ...item, available: Boolean(item.available) }));
    return sendJson(response, 200, { items });
  }

  if (method === "POST" && path === "/api/orders") {
    const body = await readJson(request);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
      return sendJson(response, 400, { error: "Choose between 1 and 30 menu items." });
    }
    const serviceType = body.service_type;
    if (serviceType !== "dine_in" && serviceType !== "takeaway") {
      return sendJson(response, 400, { error: "Choose dine-in or take-away service." });
    }
    const tableNumber = serviceType === "dine_in" && typeof body.table_number === "string"
      ? body.table_number.trim().slice(0, 30)
      : "";
    if (serviceType === "dine_in" && !/^[a-zA-Z0-9 -]{1,30}$/.test(tableNumber)) {
      return sendJson(response, 400, { error: "A valid table number is required for dine-in orders." });
    }

    const quantities = new Map();
    for (const item of body.items) {
      if (!item || typeof item.id !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
        return sendJson(response, 400, { error: "Each item needs a valid menu item and quantity (1–20)." });
      }
      if (item.preferences !== undefined && typeof item.preferences !== "string") {
        return sendJson(response, 400, { error: "Meal preferences must be provided as text." });
      }
      const preferences = typeof item.preferences === "string" ? item.preferences.trim() : "";
      if (preferences.length > 240) {
        return sendJson(response, 400, { error: "Meal preferences must be 240 characters or fewer." });
      }
      const existingSelection = quantities.get(item.id);
      if (existingSelection) {
        if (existingSelection.preferences !== preferences) {
          return sendJson(response, 400, { error: "Repeated menu items must use identical meal preferences." });
        }
        existingSelection.quantity += item.quantity;
        if (existingSelection.quantity > 20) return sendJson(response, 400, { error: "Maximum quantity per item is 20." });
      } else {
        quantities.set(item.id, { quantity: item.quantity, preferences });
      }
    }

    const items = [];
    let totalCents = 0;
    for (const [id, selection] of quantities) {
      const { quantity, preferences } = selection;
      const menuItem = await db.prepare("SELECT id, name, category, price_cents, available FROM menu_items WHERE id = ?").get(id);
      if (!menuItem || !menuItem.available) {
        return sendJson(response, 400, { error: "One or more selected items are no longer available. Please refresh the menu." });
      }
      if (menuItem.category !== "Meals" && preferences) {
        return sendJson(response, 400, { error: "Preferences can only be added to meals." });
      }
      items.push({ ...menuItem, quantity, preferences });
      totalCents += menuItem.price_cents * quantity;
    }

    const id = randomUUID();
    const receiptToken = randomBytes(32).toString("base64url");
    const receiptTokenHash = createHash("sha256").update(receiptToken).digest("hex");
    const createdAt = new Date().toISOString();
    const orderStatements = [{
      sql: `
        INSERT INTO orders (id, receipt_token_hash, table_number, service_type, status, payment_status, total_cents, created_at)
        VALUES (?, ?, ?, ?, 'queued', 'pending', ?, ?)
      `,
      params: [id, receiptTokenHash, tableNumber, serviceType, totalCents, createdAt],
    }];
    for (const item of items) {
      orderStatements.push({
        sql: `
        INSERT INTO order_items (order_id, menu_item_id, name, quantity, price_cents, preferences)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        params: [id, item.id, item.name, item.quantity, item.price_cents, item.preferences],
      });
    }
    await db.transaction(orderStatements);
    return sendJson(response, 201, { id, receipt_token: receiptToken });
  }

  const receiptMatch = path.match(/^\/api\/orders\/([0-9a-f-]+)$/i);
  if (method === "GET" && receiptMatch) {
    const order = await orderDetails(receiptMatch[1]);
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] || "";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const provided = Buffer.from(tokenHash);
    const expected = Buffer.from(order?.receipt_token_hash || "0".repeat(64));
    if (!order || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return sendJson(response, 404, { error: "Receipt not found." });
    }
    const { receipt_token_hash, ...publicOrder } = order;
    return sendJson(response, 200, publicOrder);
  }

  if (method === "POST" && path === "/api/staff/login") {
    const ip = request.socket.remoteAddress || "unknown";
    const attempts = checkLoginLimit(ip);
    if (attempts.count >= 5) return sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });

    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const usernameHash = createHash("sha256").update(username).digest();
    const passwordHash = scryptSync(password, loginSalt, 64);
    const validUsername = timingSafeEqual(usernameHash, expectedUsernameHash);
    const validPassword = timingSafeEqual(passwordHash, expectedPasswordHash);
    if (!validUsername || !validPassword) {
      attempts.count += 1;
      return sendJson(response, 401, { error: "Username or password is incorrect." });
    }

    loginAttempts.delete(ip);
    const id = randomBytes(32).toString("base64url");
    sessions.set(id, Date.now() + sessionDurationMs);
    return sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `restaurant_staff=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationMs / 1000}${secureCookie()}`,
    });
  }

  if (method === "POST" && path === "/api/staff/logout") {
    const id = cookieValue(request, "restaurant_staff");
    sessions.delete(id);
    return sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `restaurant_staff=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie()}`,
    });
  }

  if (path.startsWith("/api/staff/") && !requireStaff(request, response)) return;

  if (method === "GET" && path === "/api/staff/orders") {
    const orders = await db.prepare("SELECT id FROM orders ORDER BY created_at DESC LIMIT 200").all();
    return sendJson(response, 200, { orders: await Promise.all(orders.map((order) => orderDetails(order.id))) });
  }

  if (method === "GET" && path === "/api/staff/qr") {
    const forwardedProtocol = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
    const protocol = forwardedProtocol === "https" || request.socket.encrypted ? "https" : "http";
    const origin = process.env.PUBLIC_APP_URL || `${protocol}://${request.headers.host || `localhost:${port}`}`;
    const menuUrl = new URL("/", origin);
    const svg = await QRCode.toString(menuUrl.toString(), {
      type: "svg",
      margin: 1,
      width: 280,
      color: { dark: "#234631", light: "#ffffff" },
    });
    response.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    return response.end(svg);
  }

  if (method === "POST" && path === "/api/staff/menu") {
    const body = await readJson(request);
    const item = validateMenuInput(body);
    if (!item) return sendJson(response, 400, { error: "Enter a name, description, category, emoji, and a valid price." });
    const id = randomUUID();
    await db.prepare(`
      INSERT INTO menu_items (id, name, description, category, price_cents, emoji)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, item.name, item.description, item.category, item.price_cents, item.emoji);
    return sendJson(response, 201, { id });
  }

  const orderUpdateMatch = path.match(/^\/api\/staff\/orders\/([0-9a-f-]+)$/i);
  if (method === "PATCH" && orderUpdateMatch) {
    const body = await readJson(request);
    const order = await db.prepare("SELECT status, payment_status FROM orders WHERE id = ?").get(orderUpdateMatch[1]);
    if (!order) return sendJson(response, 404, { error: "Order not found." });

    if (body.status !== undefined) {
      const nextStatus = { queued: "preparing", preparing: "ready" }[order.status];
      if (!nextStatus || body.status !== nextStatus) {
        return sendJson(response, 409, { error: "This kitchen status transition is not allowed." });
      }
      await db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(nextStatus, orderUpdateMatch[1]);
    } else if (body.payment_status === "paid" && order.payment_status === "pending") {
      await db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(orderUpdateMatch[1]);
    } else {
      return sendJson(response, 400, { error: "Choose a valid kitchen or payment status update." });
    }
    return sendJson(response, 200, { order: await orderDetails(orderUpdateMatch[1]) });
  }

  const menuUpdateMatch = path.match(/^\/api\/staff\/menu\/([a-z0-9-]+)$/i);
  if (method === "PATCH" && menuUpdateMatch) {
    const body = await readJson(request);
    const existing = await db.prepare("SELECT * FROM menu_items WHERE id = ?").get(menuUpdateMatch[1]);
    if (!existing) return sendJson(response, 404, { error: "Menu item not found." });
    if (typeof body.available === "boolean") {
      await db.prepare("UPDATE menu_items SET available = ? WHERE id = ?").run(usePostgres ? body.available : Number(body.available), menuUpdateMatch[1]);
    } else {
      const item = validateMenuInput({ ...existing, ...body, price: body.price ?? String(existing.price_cents / 100) });
      if (!item) return sendJson(response, 400, { error: "Enter a name, description, category, emoji, and a valid price." });
      await db.prepare(`
        UPDATE menu_items SET name = ?, description = ?, category = ?, price_cents = ?, emoji = ?
        WHERE id = ?
      `).run(item.name, item.description, item.category, item.price_cents, item.emoji, menuUpdateMatch[1]);
    }
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: "Not found." });
}

function validateMenuInput(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const category = typeof body.category === "string" ? body.category : "";
  const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
  const price = typeof body.price === "string" || typeof body.price === "number" ? String(body.price).trim() : "";
  if (!name || name.length > 70 || !description || description.length > 200 ||
      !["Meals", "Beverages", "Desserts"].includes(category) ||
      !emoji || emoji.length > 8 || !/^\d{1,5}$/.test(price)) return null;
  const priceCents = Number(price) * 100;
  if (!Number.isSafeInteger(priceCents) || priceCents < 1 || priceCents > 9_999_999) return null;
  return { name, description, category, emoji, price_cents: priceCents };
}

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { status: "ok" });
  }
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) console.error("Request failed:", error);
      sendJson(response, status, { error: status === 500 ? "An unexpected server error occurred." : error.message });
    }
    return;
  }

  const appRoute = url.pathname === "/staff" || url.pathname === "/staff/" ||
    /^\/receipt\/[0-9a-f-]+$/i.test(url.pathname);
  const staticFile = staticFiles.get(url.pathname) || (appRoute ? staticFiles.get("/") : null);
  if (!staticFile || request.method !== "GET") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Not found.");
  }
  try {
    const content = readFileSync(resolve(staticFile[0]));
    response.writeHead(200, {
      "Content-Type": staticFile[1],
      "Cache-Control": "no-cache",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch (error) {
    console.error("Static file could not be served:", error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("The app could not load. Check the server files.");
  }
});

server.listen(port, () => {
  console.log(`KAIKAIGUD ordering server listening on port ${port} (${usePostgres ? "Neon PostgreSQL" : "local SQLite"}).`);
});

process.once("SIGTERM", () => {
  server.close(async (error) => {
    if (error) {
      console.error("The server did not shut down cleanly:", error);
      process.exitCode = 1;
    }
    try {
      await db.close();
    } catch (closeError) {
      console.error("The database connection did not close cleanly:", closeError);
      process.exitCode = 1;
    }
  });
});
