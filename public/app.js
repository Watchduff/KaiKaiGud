const app = document.querySelector("#app");
const tableLabel = document.querySelector("#table-label");
const staffLink = document.querySelector("#staff-link");
const toast = document.querySelector("#toast");
const path = window.location.pathname;
const isStaffPage = path === "/staff" || path === "/staff/";
const query = new URLSearchParams(window.location.search);
let tableNumber = query.get("table")?.trim().slice(0, 30) || "";
let language = localStorage.getItem("good-thyme-language") === "en" ? "en" : "bi";
let serviceType = query.get("service") === "dine_in" || query.get("service") === "takeaway"
  ? query.get("service")
  : null;
let receiptStorageKey = `good-thyme-receipt-${tableNumber || "1"}`;
let menuItems = [];
let cart = {};
let preferences = {};
let selectedCategory = "All";
let toastTimer;
let refreshTimer;

tableLabel.textContent = isStaffPage ? "Wok ples blong tim" : "Oda blong kaekae";
staffLink.hidden = isStaffPage;
staffLink.innerHTML = 'Log in blong ol wokman <span aria-hidden="true">↗</span>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function money(cents) {
  return `VT ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(cents / 100)}`;
}

function text(english, bislama) {
  return language === "en" ? english : bislama;
}

function setLanguage(nextLanguage) {
  language = nextLanguage === "en" ? "en" : "bi";
  localStorage.setItem("good-thyme-language", language);
  document.documentElement.lang = language;
  document.title = text("KAIKAIGUD — Order food", "KAIKAIGUD — Oda blong kaekae");
  document.querySelector('meta[name="description"]').content = text(
    "Browse the menu, send your order, and pay at the counter.",
    "Lukluk long menu, sendem oda, mo pem long kaonta.",
  );
  const footer = document.querySelectorAll(".site-footer span");
  footer[0].textContent = text("Made fresh, served with care.", "Mekem niu, givim wetem kea.");
  footer[1].textContent = text("Questions? Our team is here to help.", "Gat kwestin? Tim blong mifala i stap long ples ya.");
  tableLabel.textContent = isStaffPage
    ? "Wok ples blong tim"
    : serviceType === "takeaway" ? text("Take away", "Tekemaot")
      : serviceType === "dine_in" && tableNumber ? text(`Table ${tableNumber}`, `Tebol ${tableNumber}`)
        : text("Food order", "Oda blong kaekae");
  staffLink.innerHTML = `${text("Staff sign in", "Log in blong ol wokman")} <span aria-hidden="true">↗</span>`;
}

function categoryLabel(category) {
  return ({ All: "All", Meals: "Meals", Beverages: "Beverages", Desserts: "Desserts" })[category] || category;
}

function translatedError(message) {
  if (language === "en") return message;
  const translations = {
    "Something went wrong. Please try again.": "I gat wan problem. Plis traem bakegen.",
    "An unexpected server error occurred.": "I gat wan problem long server. Plis traem bakegen.",
    "Request body is too large.": "Infomesen ia i big tumas. Plis traem bakegen.",
    "Request body must be valid JSON.": "Infomesen ia i no stret. Plis traem bakegen.",
    "Choose between 1 and 30 menu items.": "Jusum wan kasem 30 kaekae long menu.",
    "A table number is required.": "Yu mas putum namba blong tebol.",
    "Choose dine-in or take-away service.": "Jusum kaikai long ples o tekemaot.",
    "A valid table number is required for dine-in orders.": "Putum wan stret nem o namba blong tebol.",
    "Each item needs a valid menu item and quantity (1–20).": "Evri kaekae i mas gat wan stret namba (1 kasem 20).",
    "Maximum quantity per item is 20.": "Yu save oda kasem 20 blong wan kaekae nomo.",
    "Meal preferences must be 240 characters or fewer.": "Tok save blong kaekae i mas gat 240 leta o sot moa.",
    "Meal preferences must be provided as text.": "Tok save blong kaekae i mas wan tok.",
    "Repeated menu items must use identical meal preferences.": "Ol kaekae semak we oli ripitim oli mas gat sem tok save.",
    "Preferences can only be added to meals.": "Yu save putum tok save long kaekae nomo.",
    "One or more selected items are no longer available. Please refresh the menu.": "Sam kaekae we yu jusum i no moa stap. Plis mekem menu i niu bakegen.",
    "Receipt not found.": "Mifala i no save faenem resit ya.",
    "Too many sign-in attempts. Try again in 15 minutes.": "Yu traem blong log in plante taem. Plis wet 15 minit, afta traem bakegen.",
    "Username or password is incorrect.": "Nem blong yus o paswod i no stret.",
    "Staff sign-in required.": "Yu mas log in fastaem blong go insaed.",
    "Order not found.": "Mifala i no save faenem oda ya.",
    "This kitchen status transition is not allowed.": "Yu no save jenisim oda long fasin ya.",
    "Choose a valid kitchen or payment status update.": "Jusum wan stret jenis long oda o pei.",
    "Menu item not found.": "Mifala i no save faenem kaekae ya long menu.",
    "Enter a name, description, category, emoji, and a valid price.": "Putum nem, tok save, grup, pikja, mo stret praes.",
    "Enter a table label using letters or numbers.": "Putum nem blong tebol wetem ol leta o namba nomo.",
    "Not found.": "Mifala i no save faenem pej ya.",
  };
  return translations[message] || "I gat wan problem. Plis traem bakegen.";
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error(text("Could not reach the server. Check your connection and try again.", "Mifala i no save kasem server. Plis jekem koneksen blong yu mo traem bakegen."));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(translatedError(data.error || "Something went wrong. Please try again."));
    error.status = response.status;
    throw error;
  }
  return data;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function getSavedReceipt() {
  try {
    return JSON.parse(sessionStorage.getItem(receiptStorageKey) || "null");
  } catch {
    return null;
  }
}

function saveReceipt(receipt) {
  sessionStorage.setItem(receiptStorageKey, JSON.stringify(receipt));
}

function updateServiceContext(type, table = "") {
  serviceType = type;
  tableNumber = type === "dine_in" ? table.trim().slice(0, 30) : "";
  receiptStorageKey = `good-thyme-receipt-${tableNumber || "takeaway"}`;
  setLanguage(language);
  const params = new URLSearchParams({ service: type });
  if (tableNumber) params.set("table", tableNumber);
  history.replaceState(null, "", `/?${params.toString()}`);
}

function statusLabel(status) {
  const labels = {
    queued: text("Queued", "I stap wet"),
    preparing: text("Preparing", "Oli stap mekem"),
    ready: text("Ready", "I redi"),
  };
  return labels[status] || status;
}

async function loadMenu() {
  const data = await api("/api/menu");
  menuItems = data.items;
}

function renderServiceChoice() {
  setLanguage(language);
  app.innerHTML = `
    <section class="service-choice-wrap">
      <div class="language-picker" aria-label="${text("Choose language", "Jusum lanwis")}">
        <span>${text("Language", "Lanwis")}</span>
        <button type="button" class="${language === "en" ? "active" : ""}" data-action="language" data-language="en" aria-pressed="${language === "en"}">English</button>
        <button type="button" class="${language === "bi" ? "active" : ""}" data-action="language" data-language="bi" aria-pressed="${language === "bi"}">Bislama</button>
      </div>
      <span class="eyebrow">${text("Welcome to KAIKAIGUD", "Welkam long KAIKAIGUD")}</span>
      <h1>${text("Would you like to dine in or take away?", "Yu wantem kaikai long ples o tekem i go?")}</h1>
      <p>${text("Choose an option to start your order.", "Jusum wan long tufala opsen blong statem oda blong yu.")}</p>
      <div class="service-choice-grid">
        <button class="service-choice-card" type="button" data-action="choose-service" data-service="dine_in">
          <span class="service-choice-icon" aria-hidden="true">⌂</span>
          <strong>${text("Dine in", "Kaikai long ples")}</strong>
          <span>${text("Eat here. Enter your table number next.", "Kaikai long ples. Putum namba blong tebol.")}</span>
          <span class="service-choice-arrow" aria-hidden="true">→</span>
        </button>
        <button class="service-choice-card" type="button" data-action="choose-service" data-service="takeaway">
          <span class="service-choice-icon" aria-hidden="true">↗</span>
          <strong>${text("Take away", "Tekemaot")}</strong>
          <span>${text("Take your food to go.", "Tekem kaekae blong yu i go.")}</span>
          <span class="service-choice-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </section>`;
}

function renderTableEntry() {
  setLanguage(language);
  tableLabel.textContent = text("Dine in", "Kaikai long ples");
  app.innerHTML = `
    <section class="service-choice-wrap table-entry-wrap">
      <button class="back-link service-back" type="button" data-action="back-to-service">← ${text("Back", "Go bak")}</button>
      <span class="eyebrow">${text("Dine in", "Kaikai long ples")}</span>
      <h1>${text("What is your table number?", "Wanem namba blong tebol blong yu?")}</h1>
      <p>${text("Look for the small sign on your table.", "Luk long smol saen long tebol blong faenem namba.")}</p>
      <form id="table-entry-form" class="table-entry-form">
        <label for="customer-table">${text("Table number", "Namba blong tebol")}</label>
        <input id="customer-table" name="table" type="text" inputmode="numeric" autocomplete="off" maxlength="30" placeholder="${text("Example: 4", "Eksampol: 4")}" required>
        <button class="primary-button" type="submit">${text("Continue to menu", "Go long menu")} <span aria-hidden="true">→</span></button>
      </form>
    </section>`;
    document.querySelector("#customer-table").focus();
}

async function beginOrder(type, table = "") {
  updateServiceContext(type, table);
  app.innerHTML = '<div class="loading-state"><span class="loading-dot"></span> Mifala i stap openem menu…</div>';
  try {
    await loadMenu();
    renderMenu();
  } catch (error) {
    app.innerHTML = `<section class="error-state"><h1>Mifala i no save openem menu.</h1><p>${escapeHtml(error.message)}</p><button class="primary-button" data-action="reload">Traem bakegen</button></section>`;
  }
}

function renderMenu() {
  const receipt = getSavedReceipt();
  if (receipt) {
    renderReceipt();
    return;
  }

  const categories = ["All", ...new Set(menuItems.map((item) => item.category))];
  const visibleItems = menuItems.filter((item) => selectedCategory === "All" || item.category === selectedCategory);
  const categoryButtons = categories.map((category) => `
    <button type="button" class="category-button ${selectedCategory === category ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(categoryLabel(category))}</button>
  `).join("");
  const cards = visibleItems.map((item) => {
    const quantity = cart[item.id] || 0;
    return `
      <article class="menu-card">
        <div class="food-illustration" aria-hidden="true">${escapeHtml(item.emoji)}</div>
        <span class="item-category">${escapeHtml(categoryLabel(item.category))}</span>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.description)}</p>
        ${item.category === "Meals" && quantity ? `
          <label class="preference-field" for="preference-${escapeHtml(item.id)}">${text("Meal preferences (optional)", "Ol samting yu wantem long kaekae (opsenol)")}</label>
          <textarea id="preference-${escapeHtml(item.id)}" data-preference-id="${escapeHtml(item.id)}" maxlength="240" placeholder="${text("e.g. no onion, sauce on the side", "Eksampol: no onion, sauce on the side")}">${escapeHtml(preferences[item.id] || "")}</textarea>
        ` : ""}
        <div class="item-bottom">
          <span class="price">${money(item.price_cents)}</span>
          ${!item.available
            ? `<span class="unavailable-label">${text("Sold out", "I finis")}</span>`
            : quantity
              ? `<div class="card-quantity" aria-label="${quantity} ${escapeHtml(item.name)} yu jusum finis">
                  <button class="quantity-button" type="button" data-action="decrease" data-id="${escapeHtml(item.id)}" aria-label="${text("Remove one", "Tekemaot wan")} ${escapeHtml(item.name)}">−</button>
                  <span>${quantity}</span>
                  <button class="quantity-button" type="button" data-action="increase" data-id="${escapeHtml(item.id)}" aria-label="${text("Add one", "Adem wan")} ${escapeHtml(item.name)}">+</button>
                </div>`
              : `<button class="add-button" type="button" data-action="increase" data-id="${escapeHtml(item.id)}" aria-label="${text("Add", "Adem")} ${escapeHtml(item.name)} ${text("to your order", "long oda blong yu")}">+</button>`
          }
        </div>
      </article>`;
  }).join("");
  const quantities = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const total = menuItems.reduce((sum, item) => sum + item.price_cents * (cart[item.id] || 0), 0);

  app.innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">${text("Ordering made simple", "Oda blong yu, i isi nomo")}</span>
        <h1>${text("Choose your food.", "Jusum kaekae.")}<br><em>${text("We'll prepare it.", "Mifala i mekem.")}</em></h1>
      </div>
      <ol class="order-steps" aria-label="${text("Order steps", "Ol step blong oda")}">
        <li><span>1</span><strong>${text("Choose", "Jusum")}</strong></li>
        <li><span>2</span><strong>${text("Send", "Sendem")}</strong></li>
        <li><span>3</span><strong>${text("Pay at counter", "Pem long kaonta")}</strong></li>
      </ol>
    </section>
    <div class="service-mode-bar">
      <span>${serviceType === "takeaway" ? text("Take away", "Take away · Tekemaot") : `${text("Dine in · Table", "Dine in · Tebol")} ${escapeHtml(tableNumber)}`}</span>
      <button class="mode-change-button" type="button" data-action="change-service">${text("Change", "Jenisimaot")}</button>
    </div>
    <section aria-labelledby="menu-heading">
      <div class="menu-toolbar">
        <h2 class="menu-heading" id="menu-heading">${text("Today's menu", "Menu blong tedei")}</h2>
        <nav class="categories" aria-label="${text("Menu categories", "Ol grup blong menu")}">${categoryButtons}</nav>
      </div>
      <p class="menu-hint">${text("Add the items you want, then send your order.", "Adem kaekae we yu wantem, afta sendem oda blong yu.")}</p>
      <div class="menu-grid">${cards || `<p class="muted">${text("No items in this category.", "I no gat kaekae long grup ya.")}</p>`}</div>
    </section>
    ${quantities ? `
      <aside class="cart-bar" aria-label="${text("Your order", "Oda blong yu")}">
        <div class="cart-summary">
          <span class="cart-count">${quantities}</span>
          <div><div class="cart-title">${text("Your order", "Oda blong yu")}</div><div class="cart-subtitle">${quantities} ${quantities === 1 ? text("item", "kaekae") : text("items", "kaekae")} · ${money(total)}</div></div>
        </div>
        <button class="primary-button" type="button" data-action="submit-order">${text("Send order", "Sendem oda")} <span aria-hidden="true">→</span></button>
      </aside>` : ""}
  `;
}

async function submitOrder(button) {
  const items = Object.entries(cart).filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, quantity, preferences: preferences[id] || "" }));
  if (!items.length) return;
  button.disabled = true;
  button.textContent = text("Sending order to kitchen…", "Sendem oda i go long kijin…");
  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ service_type: serviceType, table_number: tableNumber, items }),
    });
    cart = {};
    preferences = {};
    saveReceipt({ id: result.id, token: result.receipt_token });
    history.replaceState(null, "", `/receipt/${result.id}#${result.receipt_token}`);
    renderReceipt();
  } catch (error) {
    button.disabled = false;
    button.innerHTML = `${text("Send order", "Sendem oda")} <span aria-hidden="true">→</span>`;
    showToast(error.message);
    await loadMenu();
    cart = Object.fromEntries(Object.entries(cart).filter(([id]) => menuItems.some((item) => item.id === id && item.available)));
    renderMenu();
  }
}

function renderReceipt(order = null) {
  const saved = getSavedReceipt();
  const id = saved?.id || window.location.pathname.match(/^\/receipt\/([0-9a-f-]+)$/i)?.[1];
  const token = saved?.token || window.location.hash.slice(1);
  if (!id || !token) {
    app.innerHTML = `
      <section class="error-state">
        <div class="eyebrow">${text("Receipt unavailable", "Resit i no stap")}</div>
        <h1>${text("We couldn't find this receipt.", "Mifala i no save faenem resit ya.")}</h1>
        <p>${text("Return to the menu and place your order again. If you already ordered, our counter team can help.", "Go bak long menu mo sendem oda bakegen. Sapos yu bin sendem oda finis, tim blong mifala long kaonta i save helpem yu.")}</p>
        <a class="primary-button" href="/">${text("Back to menu", "Go bak long menu")}</a>
      </section>`;
    return;
  }

  if (!order) {
    app.innerHTML = `<div class="loading-state"><span class="loading-dot"></span> ${text("Opening your receipt…", "Mifala i stap openem resit blong yu…")}</div>`;
    api(`/api/orders/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((details) => renderReceipt(details))
      .catch((error) => {
        app.innerHTML = `<section class="error-state"><div class="eyebrow">${text("Receipt unavailable", "Resit i no stap")}</div><h1>${text("We couldn't open your receipt.", "Mifala i no save openem resit blong yu.")}</h1><p>${escapeHtml(error.message)}</p><a class="back-link" href="/">${text("Back to menu", "Go bak long menu")}</a></section>`;
      });
    return;
  }

  clearInterval(refreshTimer);
  const serviceLabel = order.service_type === "takeaway"
    ? text("Take away", "Take away · Tekemaot")
    : `${text("Dine in · Table", "Dine in · Tebol")} ${escapeHtml(order.table_number)}`;
  const serviceInstructions = order.service_type === "takeaway"
    ? text("Show this receipt to our counter team and pay. We will prepare your food to take away.", "Soem resit ya long tim blong mifala long kaonta mo pem. Bae mifala i putum kaekae blong yu i rere blong yu tekem i go.")
    : text("Show this receipt to our counter team and pay here. The kitchen already has your order.", "Soem resit ya long tim blong mifala long kaonta mo pem long ples ya. Kijin i gat oda blong yu finis.");
  app.innerHTML = `
    <section class="page-wrap">
      <div class="page-topline">
        <span class="eyebrow">${text("Order received", "Mifala i kasem oda")}</span>
        <a class="back-link" href="#receipt" aria-label="${text("Your order receipt", "Resit blong oda blong yu")}">${text("Receipt", "Resit")} ↗</a>
      </div>
      <div class="receipt-layout">
        <article class="panel receipt-panel">
          <span class="status-pill ${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span>
          <h1>${text("Your order is in.", "Mifala i kasem oda blong yu.")}</h1>
          <p class="receipt-intro">${text("The kitchen has your order. Please show this receipt to our team and pay at the counter.", "Kijin i gat oda blong yu finis. Plis soem resit ya long tim blong mifala mo pem long kaonta.")}</p>
          <div class="receipt-meta"><span>${serviceLabel}</span><span>${new Date(order.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
          <div class="receipt-items">${order.items.map((item) => `
            <div class="receipt-item">
              <div><div class="receipt-item-main">${item.quantity} × ${escapeHtml(item.name)}</div><div class="receipt-item-detail">${money(item.price_cents)} ${text("each", "wanwan")}</div>${item.preferences ? `<div class="item-preference">${text("Preference", "Yu wantem")}: ${escapeHtml(item.preferences)}</div>` : ""}</div>
              <span class="receipt-item-price">${money(item.price_cents * item.quantity)}</span>
            </div>`).join("")}
          </div>
          <div class="receipt-total"><span>${text("Total due", "Yu mas pem")}</span><span>${money(order.total_cents)}</span></div>
        </article>
        <aside class="panel receipt-side">
          <div class="receipt-side-icon" aria-hidden="true">✦</div>
          <h2>${order.payment_status === "paid" ? text("Paid", "Yu pem finis") : text("Pay at the counter", "Go long kaonta blong pem")}</h2>
          <p>${order.payment_status === "paid" ? text("Thank you. We are preparing your food.", "Tangkyu we yu kam. Mifala i stap mekem kaekae blong yu.") : serviceInstructions}</p>
          <div class="order-number"><span>${text("Order number", "Namba blong oda")}</span><strong>${escapeHtml(order.id.slice(0, 8).toUpperCase())}</strong></div>
          <div class="order-number"><span>${text("Payment", "Pei")}</span><strong>${order.payment_status === "paid" ? `<span class="status-pill paid">${text("Paid", "Yu pem finis")}</span>` : `<span class="status-pill">${text("Pay at counter", "Pem long kaonta")}</span>`}</strong></div>
        </aside>
      </div>
    </section>`;

  refreshTimer = setInterval(async () => {
    try {
      const latest = await api(`/api/orders/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
      renderReceipt(latest);
    } catch (error) {
      clearInterval(refreshTimer);
      showToast(error.message);
    }
  }, 15_000);
}

function renderLogin(errorMessage = "") {
  app.innerHTML = `
    <section class="login-wrap">
      <span class="eyebrow">Tim blong KAIKAIGUD</span>
      <h1>Welkam bakegen.</h1>
      <p>Log in blong luk ol oda long kijin mo mekem menu i niu tedei.</p>
      ${errorMessage ? `<p class="form-error" role="alert">${escapeHtml(errorMessage)}</p>` : ""}
      <form id="login-form">
        <div class="form-field"><label for="username">Nem blong yus</label><input id="username" name="username" autocomplete="username" required></div>
        <div class="form-field"><label for="password">Paswod</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="primary-button login-submit" type="submit">Log in <span aria-hidden="true">→</span></button>
      </form>
      <div class="lock-note">Ol wokman we oli gat raet nomo oli save go insaed. Taem man i sendem oda blong hem, oda ya i go long kijin mo hem i no save jenisem long resit.</div>
    </section>`;
  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      await api("/api/staff/login", {
        method: "POST",
        body: JSON.stringify({
          username: new FormData(event.currentTarget).get("username"),
          password: new FormData(event.currentTarget).get("password"),
        }),
      });
      await renderStaff();
    } catch (error) {
      renderLogin(error.message);
    }
  });
}

let staffTab = "orders";
let staffOrders = [];
let staffMenuItems = [];

async function renderStaff() {
  clearInterval(refreshTimer);
  try {
    const [ordersData, menuData] = await Promise.all([
      api("/api/staff/orders"),
      api("/api/menu"),
    ]);
    staffOrders = ordersData.orders;
    staffMenuItems = menuData.items;
  } catch (error) {
    if (error.status === 401) renderLogin();
    else app.innerHTML = `<section class="error-state"><h1>Mifala i no save openem ples blong tim.</h1><p>${escapeHtml(error.message)}</p></section>`;
    return;
  }

  const content = staffTab === "orders"
    ? renderOrderCards()
    : staffTab === "menu"
      ? renderMenuManagement()
      : renderQrCodes();
  app.innerHTML = `
    <section class="staff-page">
      <div class="staff-heading">
        <div><span class="eyebrow">KAIKAIGUD</span><h1>${staffTab === "orders" ? "Ol oda blong tedei" : staffTab === "menu" ? "Menu blong yu" : "QR kod blong ol tebol"}</h1><p>${staffTab === "orders" ? "Lukluk mo mekem ol oda long kijin." : staffTab === "menu" ? "Mekem jenis long kaekae we i stap long menu." : "Mekem wan kod blong evri tebol."}</p></div>
        <div class="staff-actions"><button class="secondary-button" data-action="refresh">Mekem niu</button><button class="secondary-button" data-action="logout">Log out</button></div>
      </div>
      <nav class="staff-tabs" aria-label="Ol wok">
        <button class="staff-tab ${staffTab === "orders" ? "active" : ""}" data-tab="orders"><span aria-hidden="true">▤</span> Ol oda <span class="tab-count">${staffOrders.length}</span></button>
        <button class="staff-tab ${staffTab === "menu" ? "active" : ""}" data-tab="menu"><span aria-hidden="true">☷</span> Menu</button>
        <button class="staff-tab ${staffTab === "qr" ? "active" : ""}" data-tab="qr"><span aria-hidden="true">▦</span> QR kod</button>
      </nav>
      <div id="staff-content">${content}</div>
    </section>`;
  if (staffTab === "orders") {
    refreshTimer = setInterval(async () => {
      try {
        const data = await api("/api/staff/orders");
        staffOrders = data.orders;
        const contentElement = document.querySelector("#staff-content");
        if (contentElement && staffTab === "orders") contentElement.innerHTML = renderOrderCards();
      } catch (error) {
        if (error.status === 401) {
          clearInterval(refreshTimer);
          renderLogin();
        } else {
          showToast(error.message);
        }
      }
    }, 15_000);
  }
}

function renderQrCodes() {
  return `
    <section class="panel qr-panel">
      <div>
        <h2>Wan QR kod nomo blong evriwan.</h2>
        <p>Printim kod ya mo putum long ol tebol. Ol man oli jusum dine in o take away taem oli openem menu.</p>
        <div class="qr-url-row"><code id="qr-url">${escapeHtml(new URL("/", window.location.origin).toString())}</code><button class="secondary-button" data-action="copy-qr-link">Kopi link</button></div>
        <div class="qr-actions"><button class="secondary-button" data-action="print-qr">Printim universal QR kod</button></div>
      </div>
      <figure class="qr-preview">
        <img class="qr-brand" src="/kaikaigud-logo.png" alt="KAIKAIGUD brand logo">
        <img id="qr-image" src="/api/staff/qr" alt="QR kod blong menu blong KAIKAIGUD" width="240" height="240">
        <figcaption>Menu blong KAIKAIGUD</figcaption>
      </figure>
    </section>`;
}

function renderOrderCards() {
  if (!staffOrders.length) return '<div class="empty-state">I no gat oda yet. Ol niu oda bae oli kam long ples ya.</div>';
  return `<div class="orders-grid">${staffOrders.map((order) => `
    <article class="order-card">
      <div class="order-card-top">
        <div><strong>${order.service_type === "takeaway" ? "TAKE AWAY" : `DINE IN · Tebol ${escapeHtml(order.table_number)}`} · #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</strong><time>${new Date(order.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</time></div>
        <span class="status-pill ${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span>
      </div>
      <div class="order-lines">${order.items.map((item) => `<div class="order-line"><span><strong>${item.quantity}×</strong> ${escapeHtml(item.name)}${item.preferences ? `<small class="item-preference">${text("Preference", "Yu wantem")}: ${escapeHtml(item.preferences)}</small>` : ""}</span><span>${money(item.price_cents * item.quantity)}</span></div>`).join("")}</div>
      <div class="order-card-bottom">
        <span class="order-total">${money(order.total_cents)}${order.payment_status === "paid" ? ' <span class="paid-label">· PEM FINIS</span>' : ""}</span>
        <div class="order-controls">
          ${order.payment_status === "pending" ? `<button class="secondary-button" data-action="mark-paid" data-id="${escapeHtml(order.id)}">Makem se i pem finis</button>` : ""}
          ${order.status === "queued" ? `<button class="secondary-button" data-action="advance-order" data-id="${escapeHtml(order.id)}" data-status="preparing">Statem blong mekem</button>` : ""}
          ${order.status === "preparing" ? `<button class="secondary-button" data-action="advance-order" data-id="${escapeHtml(order.id)}" data-status="ready">Makem se i redi</button>` : ""}
        </div>
      </div>
    </article>`).join("")}</div>`;
}

function renderMenuManagement() {
  return `
    <details class="panel menu-editor">
      <summary class="menu-editor-summary"><span class="add-menu-icon" aria-hidden="true">+</span><span><strong>Adem niu kaekae</strong><small>Putum niu kaekae long menu</small></span></summary>
      <form id="new-menu-item" class="menu-editor-form">
      <div class="menu-form-grid">
        <div class="form-field"><label for="new-name">Nem blong kaekae</label><input id="new-name" name="name" maxlength="70" required></div>
        <div class="form-field"><label for="new-price">Praes (Vatu, VT)</label><input id="new-price" name="price" type="number" min="1" max="99999" step="1" inputmode="numeric" placeholder="1500" required></div>
        <div class="form-field"><label for="new-category">Grup</label><select id="new-category" name="category"><option value="Meals">Kaekae</option><option value="Beverages">Dring</option><option value="Desserts">Deset</option></select></div>
        <div class="form-field"><label for="new-emoji">Pikja (emoji)</label><input id="new-emoji" name="emoji" value="🍽️" maxlength="8" required></div>
        <div class="form-field menu-description-field"><label for="new-description">Tok save</label><input id="new-description" name="description" maxlength="200" required></div>
      </div>
      <button class="primary-button" type="submit">Adem long menu <span aria-hidden="true">+</span></button>
      </form>
    </details>
    <div class="menu-management">${staffMenuItems.map((item) => `
      <article class="manage-item manage-item-expanded">
        <div class="manage-item-heading">
          <div class="manage-item-main"><span class="manage-emoji" aria-hidden="true">${escapeHtml(item.emoji)}</span><div><strong>${escapeHtml(item.name)}</strong>          <small>${escapeHtml(categoryLabel(item.category))} · ${money(item.price_cents)}</small></div></div>
          <button class="secondary-button toggle-button" data-action="toggle-item" data-id="${escapeHtml(item.id)}" data-available="${!item.available}">${item.available ? "I stap" : "I finis"}</button>
        </div>
        <details class="edit-details">
          <summary>Jenisim kaekae</summary>
          <form class="edit-menu-item" data-id="${escapeHtml(item.id)}">
            <div class="menu-form-grid">
              <div class="form-field"><label>Nem blong kaekae</label><input name="name" value="${escapeHtml(item.name)}" maxlength="70" required></div>
              <div class="form-field"><label>Praes (Vatu, VT)</label><input name="price" type="number" min="1" max="99999" step="1" value="${(item.price_cents / 100).toFixed(0)}" inputmode="numeric" required></div>
              <div class="form-field"><label>Grup</label><select name="category">${["Meals", "Beverages", "Desserts"].map((category) => `<option value="${category}" ${category === item.category ? "selected" : ""}>${categoryLabel(category)}</option>`).join("")}</select></div>
              <div class="form-field"><label>Pikja (emoji)</label><input name="emoji" value="${escapeHtml(item.emoji)}" maxlength="8" required></div>
              <div class="form-field menu-description-field"><label>Tok save</label><input name="description" value="${escapeHtml(item.description)}" maxlength="200" required></div>
            </div>
            <button class="secondary-button" type="submit">Sevem ol jenis</button>
          </form>
        </details>
      </article>`).join("")}</div>`;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action], button[data-category], button[data-tab]");
  if (!button) return;

  if (button.dataset.category) {
    selectedCategory = button.dataset.category;
    renderMenu();
  } else if (button.dataset.action === "language") {
    setLanguage(button.dataset.language);
    renderServiceChoice();
  } else if (button.dataset.action === "increase" || button.dataset.action === "decrease") {
    const id = button.dataset.id;
    cart[id] = Math.max(0, Math.min(20, (cart[id] || 0) + (button.dataset.action === "increase" ? 1 : -1)));
    if (!cart[id]) delete cart[id];
    renderMenu();
  } else if (button.dataset.action === "submit-order") {
    await submitOrder(button);
  } else if (button.dataset.action === "choose-service") {
    if (button.dataset.service === "takeaway") await beginOrder("takeaway");
    else {
      serviceType = "dine_in";
      renderTableEntry();
    }
  } else if (button.dataset.action === "back-to-service" || button.dataset.action === "change-service") {
    tableNumber = "";
    serviceType = null;
    history.replaceState(null, "", "/");
    renderServiceChoice();
  } else if (button.dataset.tab) {
    staffTab = button.dataset.tab;
    await renderStaff();
  } else if (button.dataset.action === "refresh") {
    await renderStaff();
  } else if (button.dataset.action === "logout") {
    try {
      await api("/api/staff/logout", { method: "POST", body: "{}" });
      renderLogin();
    } catch (error) {
      showToast(error.message);
    }
  } else if (button.dataset.action === "advance-order" || button.dataset.action === "mark-paid") {
    const body = button.dataset.action === "mark-paid"
      ? { payment_status: "paid" }
      : { status: button.dataset.status };
    try {
      await api(`/api/staff/orders/${encodeURIComponent(button.dataset.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await renderStaff();
    } catch (error) {
      showToast(error.message);
    }
  } else if (button.dataset.action === "toggle-item") {
    try {
      await api(`/api/staff/menu/${encodeURIComponent(button.dataset.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ available: button.dataset.available === "true" }),
      });
      await renderStaff();
    } catch (error) {
      showToast(error.message);
    }
  } else if (button.dataset.action === "copy-qr-link") {
    try {
      await navigator.clipboard.writeText(document.querySelector("#qr-url").textContent);
      showToast("Mifala i kopi link blong menu blong tebol.");
    } catch (error) {
      showToast("Mifala i no save kopi link ya.");
    }
  } else if (button.dataset.action === "print-qr") {
    window.print();
  }
});

document.addEventListener("input", (event) => {
  const field = event.target.closest("textarea[data-preference-id]");
  if (field) preferences[field.dataset.preferenceId] = field.value;
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "table-entry-form") {
    event.preventDefault();
    const table = new FormData(form).get("table").toString().trim().slice(0, 30);
    if (!/^[a-zA-Z0-9 -]{1,30}$/.test(table)) {
      showToast("Putum wan stret nem o namba blong tebol.");
      return;
    }
    await beginOrder("dine_in", table);
    return;
  }
  if (form.id !== "new-menu-item" && !form.matches(".edit-menu-item")) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const isEdit = form.matches(".edit-menu-item");
    const url = isEdit ? `/api/staff/menu/${encodeURIComponent(form.dataset.id)}` : "/api/staff/menu";
    await api(url, { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(values) });
    await renderStaff();
    showToast(isEdit ? "Mifala i mekem menu i niu finis." : "Mifala i adem kaekae ya long menu.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
});

async function start() {
  if (isStaffPage) {
    await renderStaff();
    return;
  }
  setLanguage(language);
  const receiptId = path.match(/^\/receipt\/([0-9a-f-]+)$/i)?.[1];
  if (receiptId && !getSavedReceipt() && window.location.hash) {
    saveReceipt({ id: receiptId, token: window.location.hash.slice(1) });
  }
  if (getSavedReceipt() || receiptId) {
    renderReceipt();
    return;
  }
  if (serviceType === "dine_in" && tableNumber) {
    await beginOrder("dine_in", tableNumber);
    return;
  }
  if (serviceType === "dine_in") {
    renderTableEntry();
    return;
  }
  if (serviceType === "takeaway") {
    await beginOrder("takeaway");
    return;
  }
  renderServiceChoice();
}

document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="reload"]')) window.location.reload();
});

start();
