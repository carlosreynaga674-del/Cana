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
import {
  calculateTotals,
  formatMoney,
  makeOrderId,
  validateCheckout,
} from "./lib/order.js";
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
    <article className="product-card">
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
          <span>·</span>THC {product.thc}
        </p>
        <div className="product-bottom">
          <div>
            <strong>{formatMoney(product.price)}</strong>
            <span>{product.effect}</span>
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
    </article>
  );
}

function Totals({ totals, mode, live = false }) {
  return (
    <div className="totals">
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
          {totals.deliveryFee ? formatMoney(totals.deliveryFee) : "On us"}
        </span>
      </div>
      <div className="total-line">
        <strong>Total</strong>
        <strong>{formatMoney(totals.total)}</strong>
      </div>
      <p>
        {live
          ? "Order request total. Payment is arranged by the store after review."
          : "Demo prices. No payment will be collected."}
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
  const [orders, setOrders] = useSavedState("lc-orders", [], cleanOrders);
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
    if (submitting) return;
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
      let order;
      if (live) {
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
        order = normalizeServerOrder(result.order, result.trackingToken);
      } else {
        order = {
          id: makeOrderId(),
          createdAt: new Date().toISOString(),
          items: cart,
          totals,
          mode,
          customer,
          status: "confirmed",
          notes: checkout.notes.trim(),
          currency: "ZAR",
          serverBacked: false,
        };
      }
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
      {!live && (
        <div className="service-banner" role="status">
          <span>CLIENT PREVIEW</span> Gauteng, South Africa · Orders are not
          sent.{" "}
          {store.available
            ? "Live ordering awaits store activation."
            : "Use this preview to review the experience."}
          <a href="#shop" onClick={() => browse()}>
            Explore the app <ArrowUpRight size={12} />
          </a>
        </div>
      )}
      <div className="announcement">
        <span>A LITTLE LOUD. A LOT OF GOOD.</span>
        <p>
          <Truck size={14} /> Free delivery on orders R750+{" "}
          <span className="announcement-dot">
            <GoodMark />
          </span>{" "}
          Good things are on the way.
        </p>
        <span>FOR THE 21+ CROWD</span>
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
                {mode === "pickup" ? "PICKING UP" : "DELIVERING GOOD VIBES TO"}
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
              Shop <ChevronDown size={13} />
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setModal("story");
              }}
            >
              Our story
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setModal("guide");
              }}
            >
              The good stuff <ArrowUpRight size={13} />
            </button>
            <button
              className="mobile-nav-only"
              onClick={() => {
                setMenuOpen(false);
                openTracking();
              }}
            >
              Track order <Truck size={16} />
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
            <button className="track-button" onClick={openTracking}>
              Track order <ArrowUpRight size={15} />
            </button>
            <button
              className="bag-button"
              onClick={() => setModal("cart")}
              aria-label={`Open bag, ${totals.itemCount} items`}
            >
              <ShoppingBag size={18} />
              <span>Bag</span>
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
        <section className="hero container">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="tiny-sun">
                <GoodMark />
              </span>{" "}
              YOUR EVERYDAY, A LITTLE ELEVATED.
            </span>
            <h1>
              Good days.
              <br />
              <span>Delivered.</span>
              <svg viewBox="0 0 285 16" aria-hidden="true">
                <path d="M4 12C78 1 182 0 279 7" />
              </svg>
            </h1>
            <p>
              Thoughtfully picked cannabis for whatever
              <br className="desktop-break" /> feels like you. From our
              favorites to your door.
            </p>
            <button
              className="button dark hero-button"
              onClick={() => browse()}
            >
              Find your good <ArrowUpRight size={19} />
            </button>
            <div className="hero-footnote">
              <span className="live-dot" />
              <span>Fresh picks. Fast delivery. Really good energy.</span>
            </div>
          </div>
          <div className="hero-visual">
            <img
              src="/images/hero.webp"
              alt="Premium cannabis flower in a glass jar with a sage pouch and kraft pre-roll tube in warm afternoon light"
              fetchPriority="high"
            />
            <div className="hero-photo-label">
              <span>
                LOUD <b>+</b> CANA
              </span>
              <small>GOOD THINGS INSIDE.</small>
            </div>
            <span className="hero-tag">
              <span className="live-dot" /> YOUR NEW FAVORITE DELIVERY
            </span>
            <div className="hero-sticker">
              <span>HIGH STANDARDS.</span>
              <Sparkles size={27} />
              <strong>
                Good
                <br />
                by nature.
              </strong>
              <span>GOOD VIBES, ALWAYS.</span>
            </div>
            <div className="hero-image-bottom">
              <span>CURATED WITH CARE. DELIVERED WITH LOVE.</span>
              <ArrowDown size={18} />
            </div>
          </div>
        </section>

        <section
          className="benefits container"
          aria-label="The Loud and Cana difference"
        >
          <div>
            <span className="benefit-icon">
              <Leaf size={22} />
            </span>
            <div>
              <strong>Only the good stuff.</strong>
              <p>Thoughtfully curated. Quality first.</p>
            </div>
          </div>
          <div>
            <span className="benefit-icon">
              <Truck size={23} />
            </span>
            <div>
              <strong>Your couch is calling.</strong>
              <p>Delivery windows from 30–60 minutes.</p>
            </div>
          </div>
          <div>
            <span className="benefit-icon">
              <ShieldCheck size={23} />
            </span>
            <div>
              <strong>High standards, always.</strong>
              <p>For adults 21+. ID required at handoff.</p>
            </div>
          </div>
        </section>

        <section className="shop-section container" id="shop">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE FEEL-GOOD COLLECTION</span>
              <h2>
                Find your kind of good<span>.</span>
              </h2>
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
                  {name}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={17} />
              <input
                type="search"
                placeholder="Find your favorite"
                aria-label="Search products"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="catalog-status">
            <p>
              {showFavorites
                ? "Your saved collection"
                : category === "All good things"
                  ? "A few favorites to get you started"
                  : `A little ${category.toLowerCase()} goes a long way`}{" "}
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
                }}
              >
                Explore all products <ArrowRight size={17} />
              </button>
            </div>
          )}
        </section>

        <section className="first-order container">
          <div className="offer-sun" aria-hidden="true">
            <GoodMark />
          </div>
          <div>
            <span className="eyebrow">NEW AROUND HERE?</span>
            <h2>
              Your first good day is on us.<span> Well, 15% of it.</span>
            </h2>
            <p>A little welcome gift for a whole lot of good.</p>
          </div>
          <button
            onClick={() => {
              setPromo("LOUD15");
              setPromoInput("LOUD15");
              notify("LOUD15 applied — enjoy 15% off your bag");
            }}
            className="offer-code"
          >
            <span>USE CODE</span>
            <strong>
              LOUD15 <ArrowUpRight size={21} />
            </strong>
          </button>
        </section>
        <section className="brand-note container">
          <span className="brand-note-flower" aria-hidden="true">
            <GoodMark />
          </span>
          <h2>
            A little more care.
            <br />A little more <em>good.</em>
          </h2>
          <p>
            We believe cannabis should feel approachable.
            <br />
            So we keep the selection thoughtful, the experience simple,
            <br className="desktop-break" /> and the good energy coming.
          </p>
          <button className="text-link" onClick={() => setModal("story")}>
            Get to know Loud + Cana <ArrowUpRight size={17} />
          </button>
        </section>
      </main>

      <footer>
        <div className="footer-main container">
          <div>
            <Logo footer />
            <p>A little loud. A lot of good.</p>
          </div>
          <div className="footer-links">
            <button onClick={() => browse()}>Shop the good stuff</button>
            <button onClick={() => setModal("story")}>Our story</button>
            <button onClick={() => setModal("help")}>Need a hand?</button>
            {!offlinePreview && (
              <a href="/staff">
                Staff access <ArrowUpRight size={12} />
              </a>
            )}
          </div>
          <div className="footer-age">
            21<span>+</span>
            <small>
              GOOD THINGS.
              <br />
              FOR GROWN-UPS.
            </small>
          </div>
        </div>
        <div className="footer-bottom container">
          <span>
            © {new Date().getFullYear()} Loud + Cana. All good things reserved.
          </span>
          <p>
            Adults 21+ only. Keep out of reach of children.{" "}
            {live
              ? "Gauteng, South Africa."
              : "Client preview · Gauteng, South Africa."}
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
                <span>THC {selectedProduct.thc}</span>
                <span>{selectedProduct.effect}</span>
              </div>
              <p>{selectedProduct.description}</p>
              <div className="detail-note">
                <Leaf size={18} />
                <div>
                  <strong>Notes of good</strong>
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
                  Add to bag ·{" "}
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
                : "This app is a client preview; no products are sold."}
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
              <span className="eyebrow">A LITTLE BAG OF GOOD</span>
              <h2>
                Your bag<span>({totals.itemCount})</span>
              </h2>
            </div>
            {cart.length ? (
              <>
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
                {mode === "delivery" && (
                  <div className="free-delivery">
                    <p>
                      {totals.subtotal >= 75000 ? (
                        <>
                          <CheckCircle2 size={14} />
                          You’ve unlocked free delivery. Good choice.
                        </>
                      ) : (
                        <>
                          You’re{" "}
                          <strong>
                            {formatMoney(75000 - totals.subtotal)}
                          </strong>{" "}
                          away from free delivery.
                        </>
                      )}
                    </p>
                    <div>
                      <span
                        style={{
                          width: `${Math.min((totals.subtotal / 75000) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <div className="cart-items">
                  {cart.map((item) => (
                    <div className="cart-item" key={item.lineId}>
                      <ProductArt product={item} />
                      <div className="cart-item-details">
                        <span>
                          {item.category} · {item.type}
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
                <form className="promo-form" onSubmit={applyPromo}>
                  <input
                    aria-label="Promo code"
                    placeholder="Got a good code?"
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
                <Totals totals={totals} mode={mode} live={live} />
                <button
                  className="button dark checkout-button"
                  onClick={beginCheckout}
                >
                  Let’s check out <ArrowRight size={19} />
                </button>
                <p className="cart-note">
                  <ShieldCheck size={13} />
                  Adults 21+ ·{" "}
                  {live ? "Store-reviewed requests" : "Demo checkout"}
                </p>
              </>
            ) : (
              <div className="empty-bag">
                <ShoppingBag size={46} />
                <h3>
                  Your next good day
                  <br />
                  starts here.
                </h3>
                <p>Your bag is waiting for a little good.</p>
                <button
                  className="button dark"
                  onClick={() => {
                    closeModal();
                    browse();
                  }}
                >
                  Explore the collection <ArrowUpRight size={18} />
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {modal === "checkout" && (
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
                  : "This is a client preview. No payment is collected and no real delivery is arranged."}
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
                        "Gauteng pickup location — to be configured"}
                    </strong>
                    <p>
                      {live
                        ? "The store will confirm a pickup time after review."
                        : "Demo pickup only. No actual collection is arranged."}
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
                  : `${live ? "Submit order request" : "Place demo order"} · ${formatMoney(totals.total)}`}{" "}
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
                        "Gauteng pickup location — to be configured"}
                    </strong>
                    <p>
                      {live
                        ? "Pickup time confirmed by the store"
                        : "Client preview · No actual collection"}
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
                : "Client preview only. This does not confirm real delivery availability."}
            </small>
          </div>
        </Modal>
      )}

      {["story", "guide", "help", "privacy"].includes(modal) && (
        <Modal
          onClose={closeModal}
          title={
            {
              story: "Our story",
              guide: "The good stuff",
              help: "Need a hand?",
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
                  A little loud.
                  <br />A lot of good.
                </h2>
                <p>
                  Good cannabis. Good people. Good days. That’s the idea behind
                  Loud + Cana.
                </p>
                <p>
                  We’re creating a more thoughtful way to discover cannabis: a
                  small, carefully chosen collection, clear product information,
                  and a delivery experience that feels as easy as your favorite
                  afternoon.
                </p>
                <div className="info-highlight">
                  <Leaf size={22} />
                  <span>
                    Thoughtfully chosen. Always approachable.
                    <br />
                    Made for your kind of good.
                  </span>
                </div>
              </>
            ) : modal === "guide" ? (
              <>
                <h2>
                  Find your
                  <br />
                  kind of good.
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
                <h2>
                  A hand with
                  <br />
                  the good stuff?
                </h2>
                <div className="guide-list">
                  <div>
                    <strong>How does this app work?</strong>
                    <p>
                      {live
                        ? "Browse products, confirm you’re 21+, and submit an order request. The store reviews eligibility and availability before accepting the request."
                        : "Browse products, confirm you’re 21+, add your favourites, and place a demo order. No actual order is sent in client preview mode."}
                    </p>
                  </div>
                  <div>
                    <strong>What about delivery?</strong>
                    <p>
                      Delivery is R49, free on baskets of R750 or more.{" "}
                      {live
                        ? "Delivery is limited to the store’s configured Gauteng postal codes. Times are confirmed after review."
                        : "Delivery estimates in client preview mode are illustrative."}
                    </p>
                  </div>
                  <div>
                    <strong>Can I find my order?</strong>
                    <p>
                      Use Track order in the header. Real requests have a
                      private tracking link; demo orders can be looked up on
                      their original browser.
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
                  Your privacy.
                  <br />
                  Our good word.
                </h2>
                <p>
                  Your cart, favourites, age confirmation, postal code, and
                  recent order tracking details are stored on this browser. Keep
                  private tracking links to yourself.
                </p>
                <p>
                  {live
                    ? "Order requests are sent to the store’s server and contain your contact information, delivery details, selected items, and notes so authorised staff can review and fulfill your request. Contact the store for assistance or a personal-data request."
                    : "This client preview does not send checkout information to the store. Use sample contact details when reviewing the app."}
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
                    Product names, prices, potency, delivery estimates, and
                    confirmations are illustrative until approved by the
                    business. Adults 21+ only.
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
