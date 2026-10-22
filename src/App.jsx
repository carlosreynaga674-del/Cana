import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Heart,
  Leaf,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import { products, categories } from "./lib/products.js";
import { calculateTotals, formatMoney, validateCheckout } from "./lib/order.js";
import ProductArt from "./components/ProductArt.jsx";
import StaffDashboard from "./components/StaffDashboard.jsx";
import OrderTracking from "./components/OrderTracking.jsx";
import {
  cleanCart,
  cleanFavorites,
  cleanLocation,
  cleanOrders,
  readSavedState,
  toOrderItems,
} from "./lib/storage.js";
import {
  request,
  offlinePreview,
  defaultStore,
  normalizeServerOrder,
  createIdempotencyKey,
} from "./lib/api.js";

function useSavedState(key, fallback, sanitize = (value) => value) {
  const [value, setValue] = useState(() =>
    readSavedState(key, fallback, sanitize),
  );
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Storage may be blocked by an embedded preview. */
    }
  }, [key, value]);
  return [value, setValue];
}

function GoodMark() {
  return (
    <svg className="good-mark" viewBox="0 0 60 60" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M30 7v13" transform={`rotate(${i * 45} 30 30)`} />
        ))}
      </g>
    </svg>
  );
}

function Logo({ footer = false }) {
  return (
    <a
      href="#"
      className={`logo ${footer ? "footer-logo" : ""}`}
      aria-label="Loud and Cana home"
    >
      LOUD<span>+</span>CANA<span className="logo-period">®</span>
    </a>
  );
}

function Modal({ children, onClose, title, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      [
        ...(ref.current?.querySelectorAll(
          'button, input, select, textarea, a[href], [tabindex="0"]',
        ) || []),
      ].filter((el) => !el.disabled);
    focusable()[0]?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className={`modal-backdrop ${className}`}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={22} />
        </button>
        {children}
      </section>
    </div>
  );
}

function Quantity({ value, onChange, name = "" }) {
  return (
    <div className="quantity">
      <button
        onClick={() => onChange(value - 1)}
        aria-label={`Decrease ${name} quantity`}
      >
        <Minus size={14} />
      </button>
      <span>{value}</span>
      <button
        onClick={() => onChange(value + 1)}
        aria-label={`Increase ${name} quantity`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function ProductCard({ product, favorite, onFavorite, onSelect, onAdd }) {
  return (
    <article className="product-card" data-collection={product.collection}>
      <div className="product-image-area">
        <button
          className="art-button"
          onClick={() => onSelect(product)}
          aria-label={`View ${product.name}`}
        >
          <ProductArt product={product} />
        </button>
        {product.badge && (
          <span className={`product-badge ${product.badgeType}`}>
            {product.badge}
          </span>
        )}
        <button
          className={`favorite-button ${favorite ? "is-favorite" : ""}`}
          aria-label={`${favorite ? "Unsave" : "Save"} ${product.name}`}
          aria-pressed={favorite}
          onClick={() => onFavorite(product.id)}
        >
          <Heart size={17} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="product-content">
        <div className="product-meta">
          <span>{product.category}</span>
          <span className={`strain ${product.type.toLowerCase()}`}>
            {product.type}
          </span>
        </div>
        <button className="product-name" onClick={() => onSelect(product)}>
          {product.name}
          <ArrowUpRight size={17} />
        </button>
        <p className="product-spec">
          {product.size}
          <span>·</span>
          {product.collection}
        </p>
        <div className="product-bottom">
          <div>
            <strong>{formatMoney(product.price)}</strong>
            <span>Indicative pricing</span>
          </div>
          <button
            className="add-button"
            onClick={() => onAdd(product)}
            aria-label={`Add ${product.name} to bag`}
          >
            <Plus size={21} />
          </button>
        </div>
      </div>
      <p className="availability-note">Availability to be confirmed</p>
    </article>
  );
}

function Totals({ totals, mode, live = false }) {
  return (
    <div className="totals">
      {live && (
        <>
          <div>
            <span>Subtotal</span>
            <span>{formatMoney(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="discount-line">
              <span>LOUD15 · 15% off</span>
              <span>−{formatMoney(totals.discount)}</span>
            </div>
          )}
          <div>
            <span>{mode === "pickup" ? "Pickup" : "Delivery"}</span>
            <span>
              {totals.deliveryFee
                ? formatMoney(totals.deliveryFee)
                : "Included"}
            </span>
          </div>
        </>
      )}
      <div className="total-line">
        <strong>{live ? "Request total" : "Indicative selection total"}</strong>
        <strong>{formatMoney(live ? totals.total : totals.subtotal)}</strong>
      </div>
      <p>
        {live
          ? "Payment is arranged by the store after review."
          : "Pricing and availability are subject to confirmation. No order has been placed."}
      </p>
    </div>
  );
}

export default function App() {
  return window.location.pathname.startsWith("/staff") ? (
    <StaffDashboard />
  ) : (
    <Storefront />
  );
}

function Storefront() {
  const [category, setCategory] = useState("All good things");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const [collection, setCollection] = useState("All collections");
  const [cart, setCart] = useSavedState("lc-cart", [], cleanCart);
  const [favorites, setFavorites] = useSavedState(
    "lc-favorites",
    [],
    cleanFavorites,
  );
  const [ageVerified, setAgeVerified] = useSavedState(
    "lc-age-confirmed",
    false,
    (value) => value === true,
  );
  const [location, setLocation] = useSavedState(
    "lc-location",
    {
      postcode: "",
      address: "",
      mode: "delivery",
    },
    cleanLocation,
  );
  const [orders, setOrders] = useSavedState("lc-orders", [], (value) =>
    cleanOrders(value).filter((order) => order.serverBacked === true),
  );
  const [store, setStore] = useState(defaultStore);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [trackingBusy, setTrackingBusy] = useState(false);
  const requestKey = useRef(null);
  const live = store.mode === "live";
  useEffect(() => {
    if (offlinePreview) return;
    const controller = new AbortController();
    request("/api/config", { signal: controller.signal })
      .then((config) =>
        setStore({ ...defaultStore, ...config, available: true }),
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (offlinePreview) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("order");
    const token = new URLSearchParams(url.hash.slice(1)).get("track");
    if (!id || !token) return;
    request(`/api/orders/${encodeURIComponent(id)}`, { token })
      .then(({ order }) => {
        setActiveOrder(normalizeServerOrder(order, token));
        setModal("tracking");
      })
      .catch((error) => {
        setTrackInput(id);
        setTrackError(error.message);
        setModal("find-order");
      });
    window.history.replaceState({}, "", window.location.pathname);
  }, []);
  const [modal, setModal] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSize, setSelectedSize] = useState(0);
  const [productQuantity, setProductQuantity] = useState(1);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [toast, setToast] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);
  const [promo, setPromo] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [checkout, setCheckout] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postcode: "",
    notes: "",
    confirmed: false,
  });
  const [errors, setErrors] = useState({});
  const [trackInput, setTrackInput] = useState("");
  const [trackError, setTrackError] = useState("");
  const [activeOrder, setActiveOrder] = useState(null);
  const [locationInput, setLocationInput] = useState("");
  const [locationError, setLocationError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const toastTimer = useRef(null);
  const mode = location.mode;
  const totals = calculateTotals(cart, mode, promo);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const notify = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  };
  const closeModal = () => {
    setModal(null);
    setPendingAdd(null);
  };
  const browse = (nextCategory = "All good things") => {
    setCategory(nextCategory);
    setCollection("All collections");
    setShowFavorites(false);
    setQuery("");
    setMenuOpen(false);
    document
      .querySelector("#shop")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  function addToCart(product, quantity = 1, sizeIndex = 0) {
    if (!ageVerified) {
      setPendingAdd({ product, quantity, sizeIndex });
      setModal("age");
      return;
    }
    commitAdd(product, quantity, sizeIndex);
  }
  function commitAdd(product, quantity = 1, sizeIndex = 0) {
    const size = product.sizes?.[sizeIndex]?.label || product.size;
    const price = product.sizes?.[sizeIndex]?.price || product.price;
    const lineId = `${product.id}-${size}`;
    setCart((items) => {
      const existing = items.find((item) => item.lineId === lineId);
      return existing
        ? items.map((item) =>
            item.lineId === lineId
              ? { ...item, quantity: Math.min(item.quantity + quantity, 20) }
              : item,
          )
        : [...items, { ...product, size, price, lineId, quantity }];
    });
    notify(`${product.name} added to your bag`);
  }
  function selectProduct(product) {
    setSelectedProduct(product);
    setSelectedSize(0);
    setProductQuantity(1);
    setModal("product");
  }
  function changeQuantity(lineId, quantity) {
    setCart((items) =>
      quantity <= 0
        ? items.filter((item) => item.lineId !== lineId)
        : items.map((item) =>
            item.lineId === lineId
              ? { ...item, quantity: Math.min(quantity, 20) }
              : item,
          ),
    );
  }
  function toggleFavorite(id) {
    setFavorites((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  }
  function beginCheckout() {
    if (!live) {
      setModal("cart");
      return;
    }
    setCheckout((values) => ({
      ...values,
      address: values.address || location.address,
      postcode: values.postcode || location.postcode,
    }));
    setErrors({});
    setCheckoutError("");
    setModal("checkout");
  }
  function applyPromo(event) {
    event.preventDefault();
    const code = promoInput.trim().toUpperCase();
    if (code === "LOUD15") {
      setPromo(code);
      setPromoMessage("A little extra good: 15% off applied.");
    } else {
      setPromoMessage("That code isn’t on the list. Try LOUD15.");
    }
  }
  async function placeOrder(event) {
    event.preventDefault();
    if (submitting || !live) return;
    const nextErrors = validateCheckout(checkout, mode);
    if (!checkout.confirmed || !ageVerified)
      nextErrors.confirmed = "Please confirm you are 21 or older.";
    if (
      live &&
      mode === "delivery" &&
      !store.deliveryZips.includes(checkout.postcode.trim())
    )
      nextErrors.postcode =
        "This postal code is outside the store’s delivery area.";
    if (!cart.length) {
      setModal("cart");
      return;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() =>
        document
          .querySelector(
            '.checkout-content [aria-invalid="true"], .checkout-content .checkbox-label input',
          )
          ?.focus(),
      );
      return;
    }
    setSubmitting(true);
    setCheckoutError("");
    try {
      const customer = Object.fromEntries(
        ["name", "email", "phone", "address", "city", "postcode"].map((key) => [
          key,
          checkout[key].trim(),
        ]),
      );
      const payload = {
        items: toOrderItems(cart),
        fulfillment: mode,
        customer,
        notes: checkout.notes.trim(),
        promoCode: promo,
        ageConfirmed: true,
      };
      const signature = JSON.stringify(payload);
      if (requestKey.current?.signature !== signature)
        requestKey.current = { signature, key: createIdempotencyKey() };
      const result = await request("/api/orders", {
        method: "POST",
        body: payload,
        idempotencyKey: requestKey.current.key,
      });
      const order = normalizeServerOrder(result.order, result.trackingToken);
      setOrders((prev) => [order, ...prev].slice(0, 10));
      setActiveOrder(order);
      setCart([]);
      setPromo("");
      setPromoInput("");
      setPromoMessage("");
      requestKey.current = null;
      setModal("confirmation");
    } catch (error) {
      setCheckoutError(
        error.message ||
          "Your request could not be sent. Your bag is saved. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function refreshOrder(order = activeOrder) {
    if (!order?.serverBacked || !order.trackingToken) return;
    setTrackingBusy(true);
    setTrackError("");
    try {
      const result = await request(
        `/api/orders/${encodeURIComponent(order.id)}`,
        { token: order.trackingToken },
      );
      const updated = normalizeServerOrder(result.order, order.trackingToken);
      setActiveOrder(updated);
      setOrders((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      setTrackError(error.message);
    } finally {
      setTrackingBusy(false);
    }
  }
  function openTracking() {
    setTrackError("");
    setTrackInput("");
    if (orders.length) {
      setActiveOrder(orders[0]);
      setModal("tracking");
      refreshOrder(orders[0]);
    } else setModal("find-order");
  }
  async function findOrder(event) {
    event.preventDefault();
    setTrackError("");
    let id = trackInput.trim();
    let token;
    try {
      const link = new URL(id);
      id = link.searchParams.get("order") || "";
      token = new URLSearchParams(link.hash.slice(1)).get("track");
    } catch {
      /* An order number can also be used on the original device. */
    }
    const match = orders.find(
      (order) => order.id.toLowerCase() === id.toLowerCase(),
    );
    if (token) {
      setTrackingBusy(true);
      try {
        const { order } = await request(
          `/api/orders/${encodeURIComponent(id)}`,
          { token },
        );
        setActiveOrder(normalizeServerOrder(order, token));
        setModal("tracking");
      } catch (error) {
        setTrackError(error.message);
      } finally {
        setTrackingBusy(false);
      }
      return;
    }
    if (match) {
      setActiveOrder(match);
      setModal("tracking");
      refreshOrder(match);
    } else
      setTrackError(
        "We couldn’t find that order on this device. Paste the full private tracking link to check an order from another device.",
      );
  }
  function saveLocation(event) {
    event.preventDefault();
    if (!/^\d{4}$/.test(locationInput.trim())) {
      setLocationError("Enter a 4-digit South African postal code.");
      return;
    }
    setLocation((prev) => ({ ...prev, postcode: locationInput.trim() }));
    setLocationError("");
    setModal(null);
    notify("Your delivery area is updated");
  }

  const filteredProducts = products
    .filter(
      (p) =>
        (category === "All good things" || p.category === category) &&
        (collection === "All collections" || p.collection === collection) &&
        (!showFavorites || favorites.includes(p.id)) &&
        `${p.name} ${p.type} ${p.category} ${p.effect}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "price-low"
        ? a.price - b.price
        : sort === "price-high"
          ? b.price - a.price
          : 0,
    );

  return (
    <>
      <div className="announcement">
        <span>THE PRIVATE COLLECTION</span>
        <p>
          GAUTENG, SOUTH AFRICA <span className="announcement-dot">·</span> A
          CONSIDERED CANNABIS EXPERIENCE
        </p>
        <span>FOR ADULTS 21+</span>
      </div>
      <header className="site-header">
        <div className="header-inner">
          <Logo />
          <button
            className="location-button"
            onClick={() => {
              setLocationInput(location.postcode);
              setLocationError("");
              setModal("location");
            }}
          >
            <MapPin size={18} />
            <span>
              <small>
                {live
                  ? mode === "pickup"
                    ? "PICKUP"
                    : "DELIVERY AREA"
                  : "OUR COLLECTION"}
              </small>
              <strong>
                {location.postcode || "Gauteng, South Africa"}{" "}
                <ChevronDown size={13} />
              </strong>
            </span>
          </button>
          <nav
            className={menuOpen ? "mobile-open" : ""}
            aria-label="Main navigation"
          >
            <button className="active" onClick={() => browse()}>
              The collection <ChevronDown size={13} />
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setModal("story");
              }}
            >
              Our philosophy
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setModal("guide");
              }}
            >
              The journal <ArrowUpRight size={13} />
            </button>
            <button
              className="mobile-nav-only"
              onClick={() => {
                setMenuOpen(false);
                live || orders.length ? openTracking() : setModal("help");
              }}
            >
              {live || orders.length ? "Track order" : "Client services"}{" "}
              <Truck size={16} />
            </button>
            <button
              className="mobile-nav-only"
              onClick={() => {
                setMenuOpen(false);
                setLocationInput(location.postcode);
                setLocationError("");
                setModal("location");
              }}
            >
              Your neighborhood <MapPin size={16} />
            </button>
          </nav>
          <div className="header-actions">
            <button
              className="track-button"
              onClick={() =>
                live || orders.length ? openTracking() : setModal("help")
              }
            >
              {live || orders.length ? "Track order" : "Client services"}{" "}
              <ArrowUpRight size={15} />
            </button>
            <button
              className="bag-button"
              onClick={() => setModal("cart")}
              aria-label={`Open bag, ${totals.itemCount} items`}
            >
              <ShoppingBag size={18} />
              <span>{live ? "Bag" : "Your selection"}</span>
              <span className="bag-count">{totals.itemCount}</span>
            </button>
            <button
              className="icon-button menu-toggle"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="luxury-hero container">
          <div className="luxury-hero-copy">
            <span className="eyebrow luxury-kicker">
              THE LOUD + CANA COLLECTION
            </span>
            <span className="hero-edition">VOL. 01 / GAUTENG</span>
            <h1>
              An elevated
              <br />
              state of <em>mind.</em>
            </h1>
            <p>
              A considered collection for the art of everyday living. Explore
              distinctive flower, refined formats, and your next personal
              ritual.
            </p>
            <div className="luxury-hero-actions">
              <button className="button dark" onClick={() => browse()}>
                Discover the collection <ArrowUpRight size={18} />
              </button>
              <button className="text-link" onClick={() => setModal("story")}>
                Our philosophy <ArrowRight size={15} />
              </button>
            </div>
            <div className="luxury-hero-notes">
              <span>24 CONSIDERED SELECTIONS</span>
              <span>MADE FOR YOUR MOMENT</span>
            </div>
          </div>
          <div className="luxury-hero-visual">
            <img
              src="/images/luxury-hero.webp"
              alt="Loud and Cana amber glass reserve jar with a brass lid on deep green marble, lit by warm afternoon light"
              fetchPriority="high"
            />
            <div className="luxury-photo-caption">
              <span>THE PRIVATE COLLECTION</span>
              <span>LOUD + CANA · 2026</span>
            </div>
            <div className="luxury-photo-seal">
              <span>L+C</span>
              <small>A CONSIDERED RITUAL</small>
            </div>
          </div>
        </section>
        <section
          className="benefits container"
          aria-label="The Loud and Cana approach"
        >
          <div>
            <span className="benefit-icon">
              <Leaf size={21} />
            </span>
            <div>
              <strong>A considered collection</strong>
              <p>Signature, Reserve & Ritual.</p>
            </div>
          </div>
          <div>
            <span className="benefit-icon">
              <MapPin size={21} />
            </span>
            <div>
              <strong>Rooted in Gauteng</strong>
              <p>A South African perspective.</p>
            </div>
          </div>
          <div>
            <span className="benefit-icon">
              <ShieldCheck size={21} />
            </span>
            <div>
              <strong>For adults 21+</strong>
              <p>A thoughtful approach to every choice.</p>
            </div>
          </div>
        </section>
        <section className="shop-section container" id="shop">
          <div className="section-heading">
            <div>
              <span className="eyebrow">DISTINCTIVE BY DESIGN</span>
              <h2>The considered collection.</h2>
              <p className="collection-intro">
                Find a format that feels like you.
              </p>
            </div>
            <button
              className={`saved-filter ${showFavorites ? "selected" : ""}`}
              onClick={() => setShowFavorites(!showFavorites)}
              aria-pressed={showFavorites}
            >
              <Heart size={16} fill={showFavorites ? "currentColor" : "none"} />{" "}
              Your saved picks{" "}
              {favorites.length > 0 && <span>{favorites.length}</span>}
            </button>
          </div>
          <div className="catalog-toolbar">
            <div
              className="category-tabs"
              role="group"
              aria-label="Product categories"
            >
              {categories.map((name, index) => (
                <button
                  key={name}
                  className={category === name ? "selected" : ""}
                  onClick={() => setCategory(name)}
                >
                  {index === 0 && (
                    <span>
                      <GoodMark />
                    </span>
                  )}
                  {index === 0 ? "All products" : name}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={17} />
              <input
                type="search"
                placeholder="Search the collection"
                aria-label="Search products"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="catalog-status">
            <label className="collection-filter">
              Collection{" "}
              <select
                aria-label="Filter by collection"
                value={collection}
                onChange={(event) => setCollection(event.target.value)}
              >
                {["All collections", "Signature", "Reserve", "Ritual"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
              <ChevronDown size={12} />
            </label>
            <p>
              {showFavorites
                ? "Your saved collection"
                : category === "All good things"
                  ? "The complete edit"
                  : `${category} collection`}{" "}
              <span>({filteredProducts.length})</span>
            </p>
            <label>
              Sort by:{" "}
              <select
                aria-label="Sort products"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="featured">Featured</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
              </select>
              <ChevronDown size={12} />
            </label>
          </div>
          {filteredProducts.length ? (
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  favorite={favorites.includes(product.id)}
                  onFavorite={toggleFavorite}
                  onSelect={selectProduct}
                  onAdd={addToCart}
                />
              ))}
            </div>
          ) : (
            <div className="empty-results">
              <Search size={34} />
              <h3>No good things here. Yet.</h3>
              <p>
                {showFavorites
                  ? "Tap a heart on a product to save a little good for later."
                  : "Try another search or browse the whole collection."}
              </p>
              <button
                className="button dark"
                onClick={() => {
                  setQuery("");
                  setShowFavorites(false);
                  setCategory("All good things");
                  setCollection("All collections");
                }}
              >
                Explore all products <ArrowRight size={17} />
              </button>
            </div>
          )}
        </section>

        {!live && (
          <p className="catalog-disclosure container">
            THE COLLECTION · Product selection, pricing, potency, and
            availability require store confirmation. Online ordering is not yet
            open.
          </p>
        )}
        <section className="luxury-statement">
          <span>CONSIDERED SELECTIONS</span>
          <span>·</span>
          <em>The art of a personal ritual.</em>
          <span>·</span>
          <span>GAUTENG, SOUTH AFRICA</span>
        </section>
        <section className="luxury-editorial container">
          <div className="editorial-image">
            <img
              src="/images/luxury-editorial.webp"
              alt="Loud and Cana botanical still life with sculptural ceramics and ivory travertine"
              loading="lazy"
            />
            <span>A CONSIDERED PERSPECTIVE</span>
          </div>
          <div className="editorial-copy">
            <span className="eyebrow">THE LOUD + CANA PHILOSOPHY</span>
            <h2>
              A considered approach
              <br />
              to a <em>modern ritual.</em>
            </h2>
            <p>
              We believe the most memorable moments begin with intention. A
              detail noticed. A format chosen. Time made for yourself.
            </p>
            <p>
              Loud + Cana brings a design-led perspective to cannabis, with an
              approachable collection and a distinctive South African point of
              view.
            </p>
            <button className="text-link" onClick={() => setModal("story")}>
              Discover our philosophy <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
        <section className="luxury-journal container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">A LITTLE PERSPECTIVE</span>
              <h2>The journal.</h2>
            </div>
            <button className="text-link" onClick={() => setModal("guide")}>
              Explore the guide <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="journal-grid">
            {[
              {
                number: "01",
                category: "THE ESSENTIALS",
                title: "Find your format.",
                text: "From classic flower to contemporary formats, understand the collection before choosing.",
              },
              {
                number: "02",
                category: "THE SENSORY EDIT",
                title: "Aroma is personal.",
                text: "Citrus, earth, florals, or spice. Discover the notes that draw you in.",
              },
              {
                number: "03",
                category: "A THOUGHTFUL START",
                title: "Make an informed choice.",
                text: "Read the label, understand potency, and take time to learn what feels right for you.",
              },
            ].map((article) => (
              <button
                className="journal-card"
                key={article.number}
                onClick={() => setModal("guide")}
              >
                <span className="journal-number">{article.number}</span>
                <span className="eyebrow">{article.category}</span>
                <h3>{article.title}</h3>
                <p>{article.text}</p>
                <span className="journal-read">
                  READ THE GUIDE <ArrowUpRight size={16} />
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <div className="footer-main container">
          <div>
            <Logo footer />
            <p>A considered collection. A personal ritual.</p>
          </div>
          <div className="footer-links">
            <button onClick={() => browse()}>The collection</button>
            <button onClick={() => setModal("story")}>Our philosophy</button>
            <button onClick={() => setModal("help")}>Client services</button>
            {!offlinePreview && (
              <a href="/staff">
                Staff access <ArrowUpRight size={12} />
              </a>
            )}
          </div>
          <div className="footer-age">
            21<span>+</span>
            <small>
              THE PRIVATE
              <br />
              COLLECTION
            </small>
          </div>
        </div>
        <div className="footer-bottom container">
          <span>
            © {new Date().getFullYear()} Loud + Cana. All rights reserved.
          </span>
          <p>
            Adults 21+ only. Keep out of reach of children. Gauteng, South
            Africa.
          </p>
          <button onClick={() => setModal("privacy")}>
            Privacy & terms <ArrowUpRight size={12} />
          </button>
        </div>
      </footer>

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {modal === "product" && selectedProduct && (
        <Modal
          onClose={closeModal}
          title={selectedProduct.name}
          className="product-modal-backdrop"
        >
          <div className="product-detail">
            <ProductArt product={selectedProduct} />
            <div className="product-detail-copy">
              <span className="eyebrow">
                LOUD + CANA · {selectedProduct.category.toUpperCase()}
              </span>
              <h2>{selectedProduct.name}</h2>
              <div className="detail-tags">
                <span
                  className={`strain ${selectedProduct.type.toLowerCase()}`}
                >
                  {selectedProduct.type}
                </span>
                <span>Potency confirmed on label</span>
                <span>{selectedProduct.effect}</span>
              </div>
              <p>{selectedProduct.description}</p>
              <div className="detail-note">
                <Leaf size={18} />
                <div>
                  <strong>The aromatic profile</strong>
                  <span>{selectedProduct.flavor}</span>
                </div>
              </div>
              <div className="detail-note">
                <Sparkles size={18} />
                <div>
                  <strong>The mood</strong>
                  <span>{selectedProduct.mood}</span>
                </div>
              </div>
              {selectedProduct.serving && (
                <p className="serving-note">{selectedProduct.serving}</p>
              )}
              <label className="size-label">
                Your size
                {selectedProduct.sizes ? (
                  <select
                    value={selectedSize}
                    onChange={(event) =>
                      setSelectedSize(Number(event.target.value))
                    }
                  >
                    {selectedProduct.sizes.map((size, index) => (
                      <option value={index} key={size.label}>
                        {size.label} — {formatMoney(size.price)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="single-size">{selectedProduct.size}</span>
                )}
              </label>
              <div className="detail-add">
                <Quantity
                  value={productQuantity}
                  name={selectedProduct.name}
                  onChange={(value) =>
                    setProductQuantity(Math.max(1, Math.min(value, 20)))
                  }
                />
                <button
                  className="button dark"
                  onClick={() => {
                    addToCart(selectedProduct, productQuantity, selectedSize);
                    if (ageVerified) setModal(null);
                  }}
                >
                  {live ? "Add to bag" : "Add to selection"} ·{" "}
                  {formatMoney(
                    (selectedProduct.sizes?.[selectedSize]?.price ||
                      selectedProduct.price) * productQuantity,
                  )}
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {modal === "age" && (
        <Modal onClose={closeModal} title="Confirm your age">
          <div className="age-dialog">
            <span className="age-symbol">
              21<span>+</span>
            </span>
            <span className="eyebrow">GOOD THINGS. FOR GROWN-UPS.</span>
            <h2>
              Good things
              <br />
              come with age.
            </h2>
            <p>
              Loud + Cana is for adults 21 and older.
              <br />
              Please confirm your age to continue shopping.
            </p>
            <button
              className="button dark"
              onClick={() => {
                setAgeVerified(true);
                if (pendingAdd)
                  commitAdd(
                    pendingAdd.product,
                    pendingAdd.quantity,
                    pendingAdd.sizeIndex,
                  );
                setPendingAdd(null);
                setModal(null);
              }}
            >
              I’m 21 or older <ArrowRight size={18} />
            </button>
            <button
              className="underage-button"
              onClick={() => {
                setPendingAdd(null);
                setModal("underage");
              }}
            >
              I’m under 21
            </button>
            <small>
              Valid government-issued ID is required for any real delivery.
              <br />
              {live
                ? "Orders require store acceptance and eligibility verification."
                : "Online ordering is not yet open. Availability is subject to store confirmation."}
            </small>
          </div>
        </Modal>
      )}
      {modal === "underage" && (
        <Modal onClose={closeModal} title="Age restriction">
          <div className="simple-dialog">
            <ShieldCheck size={38} />
            <h2>
              We’ll save the good
              <br />
              for later.
            </h2>
            <p>
              This shop is for adults 21 and older. You won’t be able to add
              products or place an order.
            </p>
            <button className="button dark" onClick={closeModal}>
              Got it <Check size={18} />
            </button>
          </div>
        </Modal>
      )}

      {modal === "cart" && (
        <Modal onClose={closeModal} title="Your bag" className="cart-backdrop">
          <div className="cart-panel">
            <div className="drawer-heading">
              <span className="eyebrow">THE LOUD + CANA EDIT</span>
              <h2>
                {live ? "Your bag" : "Your selection"}
                <span>({totals.itemCount})</span>
              </h2>
            </div>
            {cart.length ? (
              <>
                {live && (
                  <div className="fulfillment-toggle">
                    <button
                      className={mode === "delivery" ? "selected" : ""}
                      onClick={() =>
                        setLocation((prev) => ({ ...prev, mode: "delivery" }))
                      }
                    >
                      <Truck size={16} />
                      Delivery
                    </button>
                    <button
                      className={mode === "pickup" ? "selected" : ""}
                      onClick={() =>
                        setLocation((prev) => ({ ...prev, mode: "pickup" }))
                      }
                    >
                      <ShoppingBag size={16} />
                      Pickup
                    </button>
                  </div>
                )}
                <div className="cart-items">
                  {cart.map((item) => (
                    <div className="cart-item" key={item.lineId}>
                      <ProductArt product={item} />
                      <div className="cart-item-details">
                        <span>
                          {item.category} · {item.collection}
                        </span>
                        <strong>{item.name}</strong>
                        <small>{item.size}</small>
                        <Quantity
                          value={item.quantity}
                          name={item.name}
                          onChange={(value) =>
                            changeQuantity(item.lineId, value)
                          }
                        />
                      </div>
                      <div className="cart-item-price">
                        <strong>
                          {formatMoney(item.price * item.quantity)}
                        </strong>
                        <button
                          onClick={() => changeQuantity(item.lineId, 0)}
                          aria-label={`Remove ${item.name}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {live && (
                  <>
                    <form className="promo-form" onSubmit={applyPromo}>
                      <input
                        aria-label="Promo code"
                        placeholder="Promotional code"
                        value={promoInput}
                        onChange={(event) => setPromoInput(event.target.value)}
                      />
                      <button type="submit" onClick={applyPromo}>
                        Apply <ArrowRight size={15} />
                      </button>
                    </form>
                    {promoMessage && (
                      <p
                        className={`promo-message ${promoMessage.startsWith("A little") ? "valid" : ""}`}
                        role="status"
                      >
                        {promoMessage}
                      </p>
                    )}
                  </>
                )}
                <Totals totals={totals} mode={mode} live={live} />
                {live ? (
                  <button
                    className="button dark checkout-button"
                    onClick={beginCheckout}
                  >
                    Let’s check out <ArrowRight size={18} />
                  </button>
                ) : (
                  <div className="catalog-service-note">
                    <ShieldCheck size={21} />
                    <h3>A considered service, coming soon.</h3>
                    <p>
                      Online ordering will open once the store’s product
                      availability and service details are confirmed. Your
                      selection is saved on this device.
                    </p>
                    <button
                      className="button dark ordering-unavailable"
                      disabled
                    >
                      Online ordering not yet available
                    </button>
                    <button className="text-link" onClick={closeModal}>
                      Continue exploring <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                <p className="cart-note">
                  {live
                    ? "Adults 21+ · Store-reviewed requests"
                    : "Collection only · No order or payment has been submitted"}
                </p>
              </>
            ) : (
              <div className="empty-bag">
                <ShoppingBag size={40} />
                <h3>
                  Your collection
                  <br />
                  starts here.
                </h3>
                <p>Save the details that speak to you.</p>
                <button
                  className="button dark"
                  onClick={() => {
                    closeModal();
                    browse();
                  }}
                >
                  Discover the collection <ArrowUpRight size={17} />
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {modal === "checkout" && live && (
        <Modal
          onClose={closeModal}
          title="Checkout"
          className="checkout-backdrop"
        >
          <div className="checkout-content">
            <button className="back-link" onClick={() => setModal("cart")}>
              <ArrowLeft size={16} /> Back to your bag
            </button>
            <span className="eyebrow">ONE MORE GOOD THING</span>
            <h2>
              Make yourself
              <br />
              right at home.
            </h2>
            <div className="demo-notice">
              <Sparkles size={18} />
              <span>
                {live
                  ? "Submit an order request for store review. No online payment is taken. Eligibility and availability must be confirmed by the store."
                  : "Online ordering is not yet open."}
              </span>
            </div>
            <form onSubmit={placeOrder} noValidate>
              <h3>Who’s the good for?</h3>
              <div className="form-grid">
                {[
                  ["name", "Full name", "text", "Jordan Green"],
                  ["email", "Email address", "email", "you@example.com"],
                  ["phone", "Phone number", "tel", "071 234 5678"],
                ].map(([key, label, type, placeholder]) => (
                  <label
                    key={key}
                    className={key === "name" ? "full-width" : ""}
                  >
                    {label}
                    <input
                      aria-label={label}
                      autoComplete={
                        key === "name"
                          ? "name"
                          : key === "phone"
                            ? "tel"
                            : "email"
                      }
                      type={type}
                      value={checkout[key]}
                      onChange={(event) => {
                        setCheckout((prev) => ({
                          ...prev,
                          [key]: event.target.value,
                        }));
                        setErrors((prev) => ({ ...prev, [key]: "" }));
                      }}
                      placeholder={placeholder}
                      aria-invalid={!!errors[key]}
                      aria-describedby={
                        errors[key] ? `${key}-error` : undefined
                      }
                    />
                    {errors[key] && (
                      <span className="field-error" id={`${key}-error`}>
                        {errors[key]}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <h3>
                {mode === "delivery" ? "Where are we headed?" : "Your pickup"}
              </h3>
              {mode === "delivery" ? (
                <div className="form-grid">
                  {[
                    ["address", "Street address", "123 Good Day Lane"],
                    ["city", "City", "Johannesburg"],
                    ["postcode", "Postal code", "2196"],
                  ].map(([key, label, placeholder]) => (
                    <label
                      key={key}
                      className={key === "address" ? "full-width" : ""}
                    >
                      {label}
                      <input
                        aria-label={label}
                        autoComplete={
                          key === "address"
                            ? "street-address"
                            : key === "city"
                              ? "address-level2"
                              : "postal-code"
                        }
                        value={checkout[key]}
                        onChange={(event) => {
                          setCheckout((prev) => ({
                            ...prev,
                            [key]: event.target.value,
                          }));
                          setErrors((prev) => ({ ...prev, [key]: "" }));
                        }}
                        placeholder={placeholder}
                        aria-invalid={!!errors[key]}
                        aria-describedby={
                          errors[key] ? `${key}-error` : undefined
                        }
                      />
                      {errors[key] && (
                        <span className="field-error" id={`${key}-error`}>
                          {errors[key]}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="pickup-info">
                  <MapPin size={20} />
                  <div>
                    <strong>
                      {store.pickupAddress ||
                        "Pickup details have not yet been announced"}
                    </strong>
                    <p>
                      {live
                        ? "The store will confirm a pickup time after review."
                        : "Pickup details will be confirmed when ordering opens."}
                    </p>
                  </div>
                </div>
              )}
              <label className="notes-label">
                {mode === "delivery" ? "Delivery notes" : "Order notes"}{" "}
                <span>(optional)</span>
                <textarea
                  value={checkout.notes}
                  placeholder="Anything we should know?"
                  onChange={(e) =>
                    setCheckout((prev) => ({ ...prev, notes: e.target.value }))
                  }
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={checkout.confirmed}
                  onChange={(e) => {
                    setCheckout((prev) => ({
                      ...prev,
                      confirmed: e.target.checked,
                    }));
                    setErrors((prev) => ({ ...prev, confirmed: "" }));
                  }}
                />
                <span>
                  I confirm I am 21 or older. I understand the store must verify
                  eligibility before fulfilling any real order.
                </span>
              </label>
              {errors.confirmed && (
                <p className="field-error">{errors.confirmed}</p>
              )}
              <Totals totals={totals} mode={mode} live={live} />
              {checkoutError && (
                <p className="checkout-error" role="alert">
                  {checkoutError}
                </p>
              )}
              <button
                type="submit"
                onClick={placeOrder}
                disabled={submitting}
                className="button dark checkout-button"
              >
                {submitting
                  ? "Sending your request…"
                  : `Submit order request · ${formatMoney(totals.total)}`}{" "}
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
        </Modal>
      )}

      {(modal === "confirmation" || modal === "tracking") && activeOrder && (
        <Modal
          onClose={closeModal}
          title={
            modal === "confirmation" ? "Order confirmation" : "Track your order"
          }
        >
          <OrderTracking
            order={activeOrder}
            confirmation={modal === "confirmation"}
            onContinue={() => {
              closeModal();
              browse();
            }}
            onLookup={() => {
              setTrackInput("");
              setTrackError("");
              setModal("find-order");
            }}
            onRefresh={() => refreshOrder()}
            refreshing={trackingBusy}
            error={trackError}
          />
        </Modal>
      )}

      {modal === "find-order" && (
        <Modal onClose={closeModal} title="Find your order">
          <div className="simple-dialog">
            <Truck size={35} />
            <span className="eyebrow">GOOD THINGS ARE ON THE WAY</span>
            <h2>Where’s my good?</h2>
            <p>
              Enter the order number from this device, or paste your private
              tracking link.
            </p>
            <form onSubmit={findOrder}>
              <label className="field-label">
                Order number or tracking link
                <input
                  value={trackInput}
                  onChange={(event) => setTrackInput(event.target.value)}
                  placeholder="LC-XXXXXXXX"
                  required
                />
              </label>
              {trackError && (
                <p className="field-error" role="alert">
                  {trackError}
                </p>
              )}
              <button
                type="submit"
                onClick={findOrder}
                disabled={trackingBusy}
                className="button dark"
              >
                Find my order <ArrowRight size={17} />
              </button>
            </form>
            <small>
              Order numbers alone work on the original browser. A private
              tracking link works across devices.
            </small>
          </div>
        </Modal>
      )}

      {modal === "location" && (
        <Modal onClose={closeModal} title="Gauteng, South Africa">
          <div className="simple-dialog location-dialog">
            <MapPin size={37} />
            <span className="eyebrow">NEIGHBORHOOD GOOD. DELIVERED.</span>
            <h2>
              Where’s your good
              <br />
              day headed?
            </h2>
            <p>
              Choose your Gauteng postal code to personalize your delivery
              experience.
            </p>
            <div className="fulfillment-toggle">
              <button
                className={mode === "delivery" ? "selected" : ""}
                onClick={() =>
                  setLocation((prev) => ({ ...prev, mode: "delivery" }))
                }
              >
                <Truck size={16} />
                Delivery
              </button>
              <button
                className={mode === "pickup" ? "selected" : ""}
                onClick={() =>
                  setLocation((prev) => ({ ...prev, mode: "pickup" }))
                }
              >
                <ShoppingBag size={16} />
                Pickup
              </button>
            </div>
            {mode === "delivery" ? (
              <form onSubmit={saveLocation}>
                <label className="field-label">
                  Your Postal code
                  <input
                    value={locationInput}
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) =>
                      setLocationInput(event.target.value.replace(/\D/g, ""))
                    }
                    placeholder="Enter 4-digit postal code"
                    aria-invalid={!!locationError}
                  />
                </label>
                {locationError && (
                  <p className="field-error">{locationError}</p>
                )}
                <button
                  className="button dark"
                  type="submit"
                  onClick={saveLocation}
                >
                  Save my neighborhood <ArrowRight size={18} />
                </button>
              </form>
            ) : (
              <>
                <div className="pickup-info">
                  <ShoppingBag size={20} />
                  <div>
                    <strong>
                      {store.pickupAddress ||
                        "Pickup details have not yet been announced"}
                    </strong>
                    <p>
                      {live
                        ? "Pickup time confirmed by the store"
                        : "Pickup is not yet available"}
                    </p>
                  </div>
                </div>
                <button className="button dark" onClick={closeModal}>
                  Sounds good <Check size={18} />
                </button>
              </>
            )}
            <small>
              {live
                ? "Delivery is available only in the store’s configured postal codes."
                : "Service areas are not yet confirmed. Entering a postal code does not establish delivery availability."}
            </small>
          </div>
        </Modal>
      )}

      {["story", "guide", "help", "privacy"].includes(modal) && (
        <Modal
          onClose={closeModal}
          title={
            {
              story: "Our philosophy",
              guide: "The journal",
              help: "Client services",
              privacy: "Privacy and terms",
            }[modal]
          }
        >
          <div className="info-dialog">
            <span className="info-flower">
              <GoodMark />
            </span>
            <span className="eyebrow">LOUD + CANA</span>
            {modal === "story" ? (
              <>
                <h2>
                  A considered
                  <br />
                  <em>point of view.</em>
                </h2>
                <p>
                  A personal ritual deserves a considered collection. That is
                  the idea behind Loud + Cana.
                </p>
                <p>
                  Our approach brings together distinctive formats, a refined
                  visual language, and clear information. Explore at your own
                  pace and build a collection around the details that interest
                  you.
                </p>
                <div className="info-highlight">
                  <Leaf size={22} />
                  <span>
                    A considered collection.
                    <br />A distinctly personal ritual.
                  </span>
                </div>
              </>
            ) : modal === "guide" ? (
              <>
                <h2>
                  A considered
                  <br />
                  <em>first step.</em>
                </h2>
                <p>A few things to know as you explore.</p>
                <div className="guide-list">
                  <div>
                    <strong>Flower & pre-rolls</strong>
                    <p>
                      Classic dried cannabis, loose or already rolled. Explore
                      aroma, format, and strain details on each product.
                    </p>
                  </div>
                  <div>
                    <strong>Edibles & drinks</strong>
                    <p>
                      Portioned, infused options. Effects can take longer to
                      appear and can last longer. Read the label; don’t take
                      more while waiting.
                    </p>
                  </div>
                  <div>
                    <strong>Vapes</strong>
                    <p>
                      Compact, inhaled formats. Check potency and package
                      information before use.
                    </p>
                  </div>
                </div>
                <p className="serving-note">
                  Cannabis affects everyone differently. Do not drive after use.
                  Keep products away from children and pets. Product
                  descriptions are illustrative and make no medical claims.
                </p>
              </>
            ) : modal === "help" ? (
              <>
                <h2>Client services.</h2>
                <div className="guide-list">
                  <div>
                    <strong>How does this app work?</strong>
                    <p>
                      {live
                        ? "Browse products, confirm you’re 21+, and submit an order request. The store reviews eligibility and availability before accepting the request."
                        : "Explore the collection, save your favourites, and build a personal selection. Online ordering is not yet open; no order or payment is submitted from the catalog."}
                    </p>
                  </div>
                  <div>
                    <strong>What about delivery?</strong>
                    <p>
                      {live
                        ? "Delivery is R49, free on baskets of R750 or more. "
                        : ""}
                      {live
                        ? "Delivery is limited to the store’s configured Gauteng postal codes. Times are confirmed after review."
                        : "Service coverage and delivery details will be announced when online ordering opens."}
                    </p>
                  </div>
                  <div>
                    <strong>Can I find my order?</strong>
                    <p>
                      Use Track order in the header. Real requests have a
                      private tracking link after submission. The catalog does
                      not generate order confirmations.
                    </p>
                  </div>
                  <div>
                    <strong>Any welcome offers?</strong>
                    <p>
                      Enter LOUD15 in your bag for 15% off the product subtotal.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2>
                  Your privacy,
                  <br />
                  <em>considered.</em>
                </h2>
                <p>
                  Your cart, favourites, age confirmation, postal code, and
                  recent order tracking details are stored on this browser. Keep
                  private tracking links to yourself.
                </p>
                <p>
                  {live
                    ? "Order requests are sent to the store’s server and contain your contact information, delivery details, selected items, and notes so authorised staff can review and fulfill your request. Contact the store for assistance or a personal-data request."
                    : "This public catalog stores selections on your device only. It does not submit orders, collect payment, or share your selection with a store."}
                </p>
                {live && store.contactEmail && (
                  <p>
                    Store contact:{" "}
                    <a href={`mailto:${store.contactEmail}`}>
                      {store.contactEmail}
                    </a>
                  </p>
                )}
                <p>
                  No online payment is collected. Clearing this site’s browser
                  storage removes saved local details. Staff login uses a secure
                  session cookie when hosted over HTTPS.
                </p>
                {!live && (
                  <p>
                    Product selection, pricing, potency, and availability
                    require business approval. No verified stock or
                    commercial-sales authorization is represented by this
                    catalog. Adults 21+ only.
                  </p>
                )}
              </>
            )}
            <button
              className="button dark"
              onClick={() => {
                closeModal();
                browse();
              }}
            >
              Explore the good stuff <ArrowUpRight size={18} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
