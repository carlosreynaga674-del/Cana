import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  HashRouter,
  MemoryRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Membership from "./components/Membership.jsx";
import PageContent from "./components/SitePages.jsx";
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
  Users,
  UserRound,
  Camera,
  MessageCircle,
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
import { products as seedProducts, categories } from "./lib/products.js";
import { publishedCatalog } from "./lib/catalog.js";
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

function useSavedState(key, fallback, sanitize = (value) => value, persist = true) {
  const [value, setValue] = useState(() =>
    readSavedState(key, fallback, sanitize),
  );
  useEffect(() => {
    if (!persist) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Storage may be blocked by an embedded preview. */
    }
  }, [key, value, persist]);
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
    <Link
      to="/"
      className={`logo ${footer ? "footer-logo" : ""}`}
      aria-label="Loud and Cana home"
    >
      <span className="brand-loud">LOUD</span>
      <span className="brand-cana">+CANA</span>
      <Leaf className="brand-leaf" size={18} />
    </Link>
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

function ProductCard({
  product,
  favorite,
  onFavorite,
  onSelect,
  onAdd,
  favoriteBusy = false,
}) {
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
          disabled={favoriteBusy}
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
            <span>{product.priceStatus === "confirmed" ? "Store price" : "Indicative pricing"}</span>
          </div>
          <button
            className="add-button"
            onClick={() => onAdd(product)}
            aria-label={`Add ${product.name} to bag`}
          >
            <ShoppingBag size={14} />
            <span>Add to selection</span>
            <Plus size={16} />
          </button>
        </div>
      </div>
      <p className="availability-note">{product.availability || "Availability to be confirmed"}</p>
    </article>
  );
}

function CatalogNotice({ loading, error, onRetry }) {
  return (
    <div className="empty-results" role={error ? "alert" : "status"}>
      <ShoppingBag size={30} />
      <h3>{loading ? "Loading the collection…" : "The collection is unavailable."}</h3>
      {error && <p>{error}</p>}
      {error && (
        <button className="button dark" onClick={onRetry}>
          Try again <ArrowRight size={17} />
        </button>
      )}
    </div>
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
  const Router = offlinePreview
    ? window.location.protocol === "about:"
      ? MemoryRouter
      : HashRouter
    : BrowserRouter;
  return (
    <Router>
      <Routes>
        <Route path="/admin/*" element={<StaffDashboard workspace="admin" />} />
        <Route path="/staff/*" element={<StaffDashboard workspace="staff" />} />
        <Route path="*" element={<Storefront />} />
      </Routes>
    </Router>
  );
}

const PAGE_TITLES = {
  home: "Quality. Culture. Community.",
  shop: "Shop the Collection",
  "our-space": "Our Space",
  about: "Our Story",
  membership: "Membership",
  contact: "Contact",
  login: "Sign In",
  signup: "Create Your Account",
  account: "Your Account",
  privacy: "Privacy Policy",
  terms: "Terms & Conditions",
  "responsible-use": "Responsible Use",
  help: "Help Centre",
  "not-found": "Page Not Found",
};

function Storefront() {
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const routePath = routeLocation.pathname.replace(/\/+$/, "") || "/";
  const routeName = routePath === "/" ? "home" : routePath.slice(1);
  const page = Object.hasOwn(PAGE_TITLES, routeName) ? routeName : "not-found";
  const [member, setMember] = useState(null);
  const [workforceRole, setWorkforceRole] = useState(null);
  const [memberLoading, setMemberLoading] = useState(!offlinePreview);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [products, setProducts] = useState(offlinePreview ? seedProducts : []);
  const [catalogReady, setCatalogReady] = useState(offlinePreview);
  const [catalogLoading, setCatalogLoading] = useState(!offlinePreview);
  const [catalogError, setCatalogError] = useState("");
  const catalogLoaded = useRef(offlinePreview);
  const catalogFlight = useRef(null);
  const catalogSequence = useRef(0);
  const productsRef = useRef(products);
  productsRef.current = products;
  const mainRef = useRef(null);
  const [category, setCategory] = useState("All good things");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const [collection, setCollection] = useState("All collections");
  const [cart, setCart] = useSavedState(
    "lc-cart", [], (value) => cleanCart(value, offlinePreview ? seedProducts : []), catalogReady,
  );
  const [favorites, setFavorites] = useSavedState(
    "lc-favorites",
    [],
    (value) => cleanFavorites(value, offlinePreview ? seedProducts : null),
    catalogReady,
  );
  const cartRef = useRef(cart);
  const memberRef = useRef(member);
  cartRef.current = cart;
  memberRef.current = member;
  const [ageAcknowledged, setAgeAcknowledged] = useSavedState(
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
    let active = true;
    let sequence = 0;
    let controller;
    const refreshWorkforce = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const current = ++sequence;
      request("/api/admin/session", { signal })
        .then((session) => {
          if (!active || signal.aborted || current !== sequence) return;
          setWorkforceRole(
            session.authenticated === true && ["admin", "staff"].includes(session.role)
              ? session.role
              : null,
          );
        })
        .catch(() => {
          if (active && !signal.aborted && current === sequence)
            setWorkforceRole(null);
        });
    };
    refreshWorkforce();
    window.addEventListener("focus", refreshWorkforce);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener("focus", refreshWorkforce);
    };
  }, []);
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
  const productSelection = useRef(null);
  productSelection.current = selectedProduct ? {
    id: selectedProduct.id,
    size: selectedProduct.sizes?.[selectedSize]?.label || selectedProduct.size,
  } : null;
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
  const [galleryIndex, setGalleryIndex] = useState(0);
  const gallery = [
    {
      src: "/images/reference-space-1.webp",
      title: "The welcome",
      text: "A bold first impression. A space with its own identity.",
    },
    {
      src: "/images/reference-space-2.webp",
      title: "The collection",
      text: "Considered displays. Room to explore every detail.",
    },
    {
      src: "/images/reference-space-3.webp",
      title: "The good-vibes corner",
      text: "A relaxed space for conversation and connection.",
    },
  ];
  const categoryCards = [
    {
      name: "Flower",
      image: "/images/reference-flower.webp",
      description: "Explore the strains",
    },
    {
      name: "Pre-rolls",
      image: "/images/reference-preroll.webp",
      description: "Ready-rolled formats",
    },
    {
      name: "Edibles",
      image: "/images/reference-gummies.webp",
      description: "Find your flavour",
    },
    {
      name: "Vapes",
      image: "/images/reference-vape.webp",
      description: "A contemporary format",
    },
    {
      name: "Accessories",
      image: "/images/reference-accessory.webp",
      description: "Complete your setup",
    },
  ];
  const featuredProducts = catalogError ? [] : products.filter((product) => product.featured).slice(0, 5);
  const visibleSavedCount = favorites.filter((id) => products.some((product) => product.id === id)).length;
  const goToSection = (id) => navigate(`/${id}`);
  const goToPage = (path) => {
    setMenuOpen(false);
    setModal(null);
    navigate(path);
  };
  const handleSessionChange = (nextMember) => {
    setMember(nextMember);
    if (nextMember) setWorkforceRole(null);
    setFavorites(nextMember ? cleanFavorites(nextMember.favorites, null) : []);
  };
  useEffect(() => {
    if (offlinePreview) return;
    const controller = new AbortController();
    request("/api/members/me", { signal: controller.signal })
      .then(({ member: currentMember }) => {
        setMember(currentMember);
        if (currentMember)
          setFavorites(cleanFavorites(currentMember.favorites, null));
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setMemberLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    document.title = `Loud + Cana — ${PAGE_TITLES[page]}`;
    const canonical = `https://loud-cana.onrender.com${routePath === "/" ? "/" : routePath}`;
    document
      .querySelector('link[rel="canonical"]')
      ?.setAttribute("href", canonical);
    document
      .querySelector('meta[property="og:url"]')
      ?.setAttribute("content", canonical);
    setMenuOpen(false);
    setModal(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    mainRef.current?.focus({ preventScroll: true });
  }, [routeLocation.pathname]);
  useEffect(() => {
    if (page !== "shop") return;
    const params = new URLSearchParams(routeLocation.search);
    const requested = params.get("category");
    setCategory(categories.includes(requested) ? requested : "All good things");
    setShowFavorites(params.get("favorites") === "1");
    setQuery(params.get("q") || "");
    setCollection(
      ["Signature", "Reserve", "Ritual"].includes(params.get("collection"))
        ? params.get("collection")
        : "All collections",
    );
    setSort(
      ["price-low", "price-high"].includes(params.get("sort"))
        ? params.get("sort")
        : "featured",
    );
  }, [routeLocation.pathname, routeLocation.search]);
  const updateShopFilters = (changes) => {
    const params = new URLSearchParams(routeLocation.search);
    Object.entries(changes).forEach(([key, value]) => {
      if (
        !value ||
        ["All good things", "All collections", "featured"].includes(value)
      )
        params.delete(key);
      else params.set(key, value);
    });
    navigate(`/shop${params.size ? `?${params}` : ""}`, { replace: true });
  };
  const toastTimer = useRef(null);
  const mode = location.mode;
  const totals = calculateTotals(cart, mode, promo);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);

  const refreshCatalog = useCallback(({ announce = true } = {}) => {
    if (offlinePreview) return Promise.resolve({ products: seedProducts, cart: cartRef.current, changed: false });
    if (catalogFlight.current) return catalogFlight.current.promise;
    const controller = new AbortController();
    const sequence = ++catalogSequence.current;
    if (!catalogLoaded.current) setCatalogLoading(true);
    const promise = request("/api/products", { signal: controller.signal })
      .then((payload) => {
        const nextProducts = publishedCatalog(payload);
        if (controller.signal.aborted || sequence !== catalogSequence.current)
          throw new Error("Collection refresh was interrupted. Please try again.");
        const wasLoaded = catalogLoaded.current;
        const previousCart = wasLoaded ? cartRef.current : readSavedState("lc-cart", [], (value) => Array.isArray(value) ? value : []);
        const nextCart = cleanCart(previousCart, nextProducts);
        const signature = (items) => JSON.stringify(items.map((item) =>
          item && typeof item === "object"
            ? [item.id, item.size, item.price, item.quantity]
            : null,
        ));
        const changed = signature(previousCart) !== signature(nextCart);
        productsRef.current = nextProducts;
        cartRef.current = nextCart;
        setProducts(nextProducts);
        setCart(nextCart);
        setCatalogError("");
        setCatalogReady(true);
        catalogLoaded.current = true;
        setFavorites((current) => cleanFavorites(memberRef.current?.favorites || current, null));
        const selection = productSelection.current;
        if (selection) {
          const next = nextProducts.find((product) => product.id === selection.id);
          setSelectedProduct(next || null);
          setSelectedSize(Math.max(0, next?.sizes?.findIndex((size) => size.label === selection.size) ?? 0));
          if (!next) setModal((value) => value === "product" ? null : value);
        }
        if (changed && previousCart.length)
          setModal((current) => current === "checkout" ? "cart" : current);
        if (announce && changed && previousCart.length)
          notify("Your selection has changed. Review the latest prices and available products in your bag.");
        return { products: nextProducts, cart: nextCart, changed };
      })
      .catch((error) => {
        if (!controller.signal.aborted && sequence === catalogSequence.current)
          setCatalogError("The collection is temporarily unavailable. Please try again.");
        throw error;
      })
      .finally(() => {
        if (sequence === catalogSequence.current) {
          catalogFlight.current = null;
          setCatalogLoading(false);
        }
      });
    catalogFlight.current = { controller, promise };
    return promise;
  }, [notify]);

  useEffect(() => {
    if (offlinePreview) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden") refreshCatalog().catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
      catalogFlight.current?.controller.abort();
      catalogFlight.current = null;
      catalogSequence.current += 1;
    };
  }, [refreshCatalog]);

  useEffect(() => {
    if (!offlinePreview && catalogLoaded.current)
      refreshCatalog().catch(() => {});
  }, [routeLocation.pathname, refreshCatalog]);
  const closeModal = () => {
    setModal(null);
    setPendingAdd(null);
  };
  const browse = (nextCategory = "All good things") => {
    setCategory(nextCategory);
    setCollection("All collections");
    setShowFavorites(false);
    setQuery("");
    setSort("featured");
    setMenuOpen(false);
    navigate(
      nextCategory === "All good things"
        ? "/shop"
        : `/shop?category=${encodeURIComponent(nextCategory)}`,
    );
  };

  function addToCart(product, quantity = 1, sizeIndex = 0) {
    if (!catalogReady || catalogError) {
      notify("Load the current collection before adding a product.");
      return;
    }
    if (!ageAcknowledged) {
      setPendingAdd({ product, quantity, sizeIndex });
      setModal("age");
      return;
    }
    commitAdd(product, quantity, sizeIndex);
  }
  function commitAdd(product, quantity = 1, sizeIndex = 0) {
    const current = productsRef.current.find((item) => item.id === product.id);
    if (!current || catalogError) {
      notify("This product is no longer available. Explore the current collection.");
      return;
    }
    const requestedSize = product.sizes?.[sizeIndex]?.label || product.size;
    sizeIndex = Math.max(0, current.sizes?.findIndex((size) => size.label === requestedSize) ?? 0);
    product = current;
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
  async function toggleFavorite(id) {
    if (favoriteBusy || memberLoading) return;
    const previous = favorites;
    const next = previous.includes(id)
      ? previous.filter((value) => value !== id)
      : [...previous, id];
    setFavorites(next);
    if (!member || offlinePreview) return;
    setFavoriteBusy(true);
    try {
      const { member: updatedMember } = await request("/api/members/me", {
        method: "PATCH",
        body: { favorites: next },
      });
      setMember(updatedMember);
      setFavorites(cleanFavorites(updatedMember.favorites, null));
    } catch (error) {
      setFavorites(previous);
      notify(
        error.message ||
          "Your favourites could not be saved. Please try again.",
      );
    } finally {
      setFavoriteBusy(false);
    }
  }
  async function beginCheckout() {
    if (!live) {
      setModal("cart");
      return;
    }
    if (!member) {
      goToPage("/signup");
      notify(
        "Create a member account and complete an ID age check before ordering.",
      );
      return;
    }
    if (member.ageVerification?.status !== "verified") {
      goToPage("/account");
      notify("Complete your ID age check before submitting an order.");
      return;
    }
    try {
      const latest = await refreshCatalog();
      if (!latest.cart.length || latest.changed) {
        setModal("cart");
        return;
      }
    } catch {
      notify("The current collection could not be checked. Please try again before ordering.");
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
    if (!member || member.ageVerification?.status !== "verified") {
      setCheckoutError(
        "An ID age check is required before an order can be submitted. Visit your account to complete it.",
      );
      return;
    }
    const nextErrors = validateCheckout(checkout, mode);
    if (!checkout.confirmed || !ageAcknowledged)
      nextErrors.confirmed = "Please confirm you are 18 or older.";
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
      const latest = await refreshCatalog();
      if (!latest.cart.length || latest.changed) {
        setModal("cart");
        return;
      }
      const customer = Object.fromEntries(
        ["name", "email", "phone", "address", "city", "postcode"].map((key) => [
          key,
          checkout[key].trim(),
        ]),
      );
      const payload = {
        items: toOrderItems(latest.cart),
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
    notify("Your postal-code preference is saved");
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
      <button
        className="skip-link"
        onClick={() => {
          mainRef.current?.focus();
          mainRef.current?.scrollIntoView();
        }}
      >
        Skip to content
      </button>
      <header className="site-header">
        <div className="header-inner container">
          <Logo />
          <nav
            className={`nav-links ${menuOpen ? "mobile-open" : ""}`}
            aria-label="Main navigation"
          >
            {[
              ["/", "Home"],
              ["/shop", "Shop"],
              ["/our-space", "Our Space"],
              ["/about", "About"],
              ["/membership", "Membership"],
              ["/contact", "Contact"],
            ].map(([path, label]) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  isActive ||
                  (path === "/membership" &&
                    ["login", "signup", "account"].includes(page))
                    ? "active"
                    : undefined
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label="Search the shop"
              onClick={() => {
                browse();
                setTimeout(
                  () =>
                    document
                      .querySelector('[aria-label="Search products"]')
                      ?.focus(),
                  250,
                );
              }}
            >
              <Search size={21} />
            </button>
            <button
              className="location-button icon-button"
              aria-label="Choose your Gauteng postal code"
              onClick={() => {
                setLocationInput(location.postcode);
                setLocationError("");
                setModal("location");
              }}
            >
              <MapPin size={20} />
              <span>{location.postcode}</span>
            </button>
            <Link
              className="icon-button account-button"
              aria-label={workforceRole ? "Open dashboard" : member ? "Your member account" : "Sign in"}
              to={workforceRole === "admin" ? "/admin" : workforceRole === "staff" ? "/staff" : member ? "/account" : "/login"}
            >
              <UserRound size={21} />
            </Link>
            <button
              className="bag-button"
              onClick={() => setModal("cart")}
              aria-label={`Open bag, ${totals.itemCount} items`}
            >
              <ShoppingBag size={21} />
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

      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {page === "home" && (
          <>
            <section className="reference-hero" id="home">
              <div className="hero-background">
                <img
                  src="/images/reference-hero.webp"
                  alt="Loud + Cana store concept with black display cabinets, lime signage and warm lighting"
                  fetchPriority="high"
                />
              </div>
              <div className="container">
                <div className="hero-copy">
                  <span className="eyebrow">
                    PREMIUM CANNABIS · LIFESTYLE · CULTURE
                  </span>
                  <h1>
                    <span className="hero-loud">LOUD</span>{" "}
                    <span className="hero-cana">+CANA</span>
                  </h1>
                  <h2 className="hero-tagline">
                    More than just cannabis.
                    <br />
                    It’s a lifestyle.
                  </h2>
                  <p className="hero-subtitle">
                    Quality. Culture. Community.
                    <br />
                    Welcome to the world of Loud + Cana.
                  </p>
                  <div className="hero-actions">
                    <button className="button lime" onClick={() => browse()}>
                      Shop the collection <ArrowRight size={17} />
                    </button>
                    <button
                      className="button outline"
                      onClick={() => goToSection("membership")}
                    >
                      Join the community <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
                <span className="hero-age">
                  18+<small>ADULTS ONLY</small>
                </span>
              </div>
            </section>
            <section
              className="benefits container"
              aria-label="The Loud and Cana approach"
            >
              <div>
                <span className="benefit-icon">
                  <Leaf size={31} />
                </span>
                <div>
                  <strong>A considered selection</strong>
                  <p>Find your own kind of good.</p>
                </div>
              </div>
              <div>
                <span className="benefit-icon">
                  <ShieldCheck size={31} />
                </span>
                <div>
                  <strong>Safe & discreet</strong>
                  <p>Your privacy matters.</p>
                </div>
              </div>
              <div>
                <span className="benefit-icon">
                  <Users size={31} />
                </span>
                <div>
                  <strong>Community driven</strong>
                  <p>Real people. Shared culture.</p>
                </div>
              </div>
              <div>
                <span className="benefit-icon">
                  <MapPin size={31} />
                </span>
                <div>
                  <strong>Rooted in South Africa</strong>
                  <p>A distinctly local perspective.</p>
                </div>
              </div>
            </section>
            <section className="category-section">
              <div className="container">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">SHOP BY CATEGORY</span>
                    <h2>
                      Find Your Perfect <span className="lime-text">Vibe</span>
                    </h2>
                  </div>
                  <button className="text-link" onClick={() => browse()}>
                    View all products <ArrowRight size={17} />
                  </button>
                </div>
                <div className="category-grid">
                  {categoryCards.map((card) => (
                    <button
                      className="category-card"
                      key={card.name}
                      onClick={() => browse(card.name)}
                    >
                      <img
                        src={card.image}
                        alt={`${card.name} collection presentation`}
                        loading="lazy"
                      />
                      <span className="category-card-copy">
                        <strong>{card.name}</strong>
                        <small>{card.description}</small>
                        <ArrowRight size={18} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="space-section" id="our-space">
              <div className="container space-layout">
                <div className="space-copy">
                  <span className="eyebrow">OUR SPACE</span>
                  <h2>
                    Step Inside
                    <br />
                    <span className="lime-text">Loud +Cana</span>
                  </h2>
                  <p>
                    Modern. Relaxed. Welcoming. Explore the vision: bold
                    interiors, thoughtful details, and room for good
                    conversation.
                  </p>
                  <button
                    className="button outline"
                    onClick={() => {
                      setGalleryIndex(0);
                      setModal("gallery");
                    }}
                  >
                    View gallery <ArrowRight size={16} />
                  </button>
                  <small className="concept-caption">
                    STORE DESIGN CONCEPT · VISUAL INSPIRATION
                  </small>
                </div>
                <div className="space-gallery">
                  {gallery.map((image, index) => (
                    <button
                      key={image.src}
                      className="space-image"
                      onClick={() => {
                        setGalleryIndex(index);
                        setModal("gallery");
                      }}
                      aria-label={`View gallery: ${image.title}`}
                    >
                      <img
                        src={image.src}
                        alt={`${image.title} — Loud + Cana store design concept`}
                        loading="lazy"
                      />
                      <span>
                        {image.title} <ArrowUpRight size={15} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="featured-section">
              <div className="container">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">FEATURED PRODUCTS</span>
                    <h2>Top Picks</h2>
                  </div>
                  <button className="text-link" onClick={() => browse()}>
                    View all products <ArrowRight size={17} />
                  </button>
                </div>
                {(catalogLoading || catalogError) && (
                  <CatalogNotice loading={catalogLoading} error={catalogError}
                    onRetry={() => refreshCatalog().catch(() => {})} />
                )}
                <div className="featured-grid">
                  {featuredProducts.map((product) => (
                    <article className="featured-card" key={product.id}>
                      <button
                        className="featured-art"
                        onClick={() => selectProduct(product)}
                        aria-label={`Explore featured ${product.name}`}
                      >
                        <ProductArt product={product} />
                      </button>
                      <div className="featured-info">
                        <h3>{product.name}</h3>
                        <small>
                          {product.category} · {product.size}
                        </small>
                        <strong>{formatMoney(product.price)}</strong>
                        <button
                          className="button lime"
                          onClick={() => addToCart(product)}
                          aria-label={`Add featured ${product.name} to selection`}
                        >
                          <ShoppingBag size={13} />
                          Add to selection
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {!live && (
                  <p className="featured-disclosure">
                    Proposed collection · Indicative prices · Availability
                    subject to store confirmation
                  </p>
                )}
              </div>
            </section>
          </>
        )}
        {page === "shop" && (
          <>
            <section className="shop-section container" id="shop">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">THE FULL LINEUP</span>
                  <h1>Find Your Next Favourite.</h1>
                  <p className="collection-intro">
                    Find a format that feels like you.
                  </p>
                </div>
                <button
                  className={`saved-filter ${showFavorites ? "selected" : ""}`}
                  onClick={() => {
                    setShowFavorites(!showFavorites);
                    updateShopFilters({
                      favorites: showFavorites ? null : "1",
                    });
                  }}
                  aria-pressed={showFavorites}
                >
                  <Heart
                    size={16}
                    fill={showFavorites ? "currentColor" : "none"}
                  />{" "}
                  Your saved picks{" "}
                  {visibleSavedCount > 0 && <span>{visibleSavedCount}</span>}
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
                      onClick={() => {
                        setCategory(name);
                        updateShopFilters({ category: name });
                      }}
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
                    onChange={(e) => {
                      setQuery(e.target.value);
                      updateShopFilters({ q: e.target.value });
                    }}
                  />
                </label>
              </div>
              <div className="catalog-status">
                <label className="collection-filter">
                  Collection{" "}
                  <select
                    aria-label="Filter by collection"
                    value={collection}
                    onChange={(event) => {
                      setCollection(event.target.value);
                      updateShopFilters({ collection: event.target.value });
                    }}
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
                    onChange={(e) => {
                      setSort(e.target.value);
                      updateShopFilters({ sort: e.target.value });
                    }}
                  >
                    <option value="featured">Featured</option>
                    <option value="price-low">Price: low to high</option>
                    <option value="price-high">Price: high to low</option>
                  </select>
                  <ChevronDown size={12} />
                </label>
              </div>
              {catalogLoading || catalogError ? (
                <CatalogNotice loading={catalogLoading} error={catalogError}
                  onRetry={() => refreshCatalog().catch(() => {})} />
              ) : filteredProducts.length ? (
                <div className="product-grid">
                  {filteredProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      favorite={favorites.includes(product.id)}
                      onFavorite={toggleFavorite}
                      favoriteBusy={favoriteBusy || memberLoading}
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
                      navigate("/shop", { replace: true });
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
                availability require store confirmation. Online ordering is not
                yet open.
              </p>
            )}
          </>
        )}
        {page === "home" && (
          <>
            <section className="about-section" id="about">
              <div className="container about-layout">
                <div className="about-photo">
                  <img
                    src="/images/reference-flower.webp"
                    alt="Botanical detail from the Loud + Cana visual collection"
                    loading="lazy"
                  />
                </div>
                <div className="about-copy">
                  <span className="eyebrow">ABOUT LOUD +CANA</span>
                  <h2>More Than Cannabis.</h2>
                  <p>
                    LOUD +CANA is built around a simple idea: culture,
                    community, and the freedom to be yourself.
                  </p>
                  <p>
                    Discover a collection with personality, explore different
                    formats, and make informed choices at your own pace.
                  </p>
                  <button
                    className="button outline"
                    onClick={() => goToPage("/about")}
                  >
                    Our story <ArrowRight size={16} />
                  </button>
                </div>
                <div className="good-vibes" aria-label="Good vibes only">
                  Good
                  <br />
                  Vibes
                  <br />
                  <span>Only.</span>
                  <Sparkles size={35} />
                </div>
              </div>
            </section>
            <section className="community-section" id="membership">
              <div className="container community-layout">
                <div className="community-copy">
                  <span className="eyebrow">JOIN OUR COMMUNITY</span>
                  <h2>
                    Your People.
                    <br />
                    <span className="lime-text">Your Kind of Good.</span>
                  </h2>
                  <p>
                    A shared appreciation for cannabis culture, considered
                    choices, and good conversation.
                  </p>
                  <button
                    className="button outline"
                    onClick={() =>
                      goToPage(member ? "/account" : "/membership")
                    }
                  >
                    {member ? "Your account" : "Discover membership"}{" "}
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="community-card">
                  <Users size={36} />
                  <h3>
                    Culture. Connection.
                    <br />
                    Community.
                  </h3>
                  <p>
                    Create a free account, save your favourites across devices,
                    and make the collection your own.
                  </p>
                  <button
                    className="text-link"
                    onClick={() => goToPage("/help")}
                  >
                    Explore the essentials <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="community-card">
                  <MessageCircle size={36} />
                  <h3>Let’s Talk.</h3>
                  <p>
                    {store.contactEmail
                      ? "Questions about the collection? Get in touch with the store."
                      : "Gauteng, South Africa. Store contact details will be published when confirmed."}
                  </p>
                  {store.contactEmail ? (
                    <a
                      className="button outline"
                      href={`mailto:${store.contactEmail}`}
                    >
                      Email the store <ArrowUpRight size={16} />
                    </a>
                  ) : (
                    <button
                      className="text-link"
                      onClick={() => goToPage("/help")}
                    >
                      Visit the help centre <ArrowUpRight size={16} />
                    </button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
        {["membership", "login", "signup", "account"].includes(page) && (
          <Membership
            key={page}
            mode={page}
            member={member}
            loading={memberLoading}
            onSessionChange={handleSessionChange}
            onNavigate={goToPage}
            store={store}
            offline={offlinePreview}
            visibleSavedCount={visibleSavedCount}
          />
        )}
        {!["home", "shop", "membership", "login", "signup", "account"].includes(
          page,
        ) && (
          <PageContent
            page={page}
            onNavigate={goToPage}
            onBrowse={browse}
            onGallery={(index) => {
              setGalleryIndex(index);
              setModal("gallery");
            }}
            onHelp={() => goToPage("/help")}
            store={store}
            member={member}
          />
        )}
      </main>

      <footer id="contact">
        <div className="footer-main container">
          <div className="footer-brand">
            <Logo footer />
            <p>
              Quality. Culture. Community.
              <br />
              Gauteng, South Africa.
            </p>
          </div>
          <div className="footer-column footer-links">
            <h3>Quick Links</h3>
            {[
              ["/", "Home"],
              ["/shop", "Shop"],
              ["/our-space", "Our Space"],
              ["/about", "About"],
              ["/membership", "Membership"],
              ["/contact", "Contact"],
            ].map(([to, label]) => (
              <Link key={to} to={to}>
                {label}
              </Link>
            ))}
          </div>
          <div className="footer-column">
            <h3>Find Your Vibe</h3>
            <div className="footer-detail">
              <MapPin size={23} />
              <p>
                Gauteng
                <br />
                South Africa
                <br />
                <small>
                  {store.pickupAddress || "Store address to be announced."}
                </small>
              </p>
            </div>
            <a
              className="button outline"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.pickupAddress || "Gauteng, South Africa")}`}
              target="_blank"
              rel="noreferrer"
            >
              {store.pickupAddress ? "Get directions" : "Explore Gauteng"}{" "}
              <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="footer-column">
            <h3>Contact Us</h3>
            <div className="footer-detail">
              <MessageCircle size={23} />
              <p>
                {store.contactEmail ? (
                  <a href={`mailto:${store.contactEmail}`}>
                    {store.contactEmail}
                  </a>
                ) : (
                  "Public contact details coming soon."
                )}
              </p>
            </div>
            <button className="text-link" onClick={() => goToPage("/help")}>
              Customer help <ArrowRight size={15} />
            </button>
            <button
              className="text-link"
              onClick={() =>
                live || orders.length ? openTracking() : goToPage("/help")
              }
            >
              {live || orders.length
                ? "Track your order"
                : "Ordering information"}{" "}
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="footer-column">
            <h3>Stay In The Know</h3>
            <p>
              Discover new formats, learn the essentials, and find your
              favourites.
            </p>
            <button className="button lime" onClick={() => goToPage("/help")}>
              Explore the guide <ArrowRight size={16} />
            </button>
          </div>
        </div>
        <div className="footer-bottom container">
          <span className="responsible-age">18+</span>
          <p>For adults 18 years and older. Please consume responsibly.</p>
          <Link to="/terms">Terms & Conditions</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/responsible-use">Responsible Use</Link>
          <span>
            © {new Date().getFullYear()} Loud +Cana. All rights reserved.
          </span>
        </div>
      </footer>

      {modal === "gallery" && (
        <Modal
          onClose={closeModal}
          title="Loud + Cana store gallery"
          className="gallery-modal-backdrop"
        >
          <div className="gallery-lightbox">
            <span className="eyebrow">THE LOUD +CANA VISION</span>
            <h2>{gallery[galleryIndex].title}</h2>
            <img
              src={gallery[galleryIndex].src}
              alt={`${gallery[galleryIndex].title} — store design concept`}
            />
            <div className="gallery-controls">
              <button
                className="icon-button"
                aria-label="Previous gallery image"
                onClick={() =>
                  setGalleryIndex(
                    (galleryIndex + gallery.length - 1) % gallery.length,
                  )
                }
              >
                <ArrowLeft />
              </button>
              <p>
                {gallery[galleryIndex].text}
                <small>
                  Store design concept · {galleryIndex + 1} / {gallery.length}
                </small>
              </p>
              <button
                className="icon-button"
                aria-label="Next gallery image"
                onClick={() =>
                  setGalleryIndex((galleryIndex + 1) % gallery.length)
                }
              >
                <ArrowRight />
              </button>
            </div>
          </div>
        </Modal>
      )}
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
                <span>
                  {selectedProduct.category === "Accessories"
                    ? "Non-consumable accessory"
                    : "Confirm potency on label"}
                </span>
                <span>{selectedProduct.effect}</span>
              </div>
              <p>{selectedProduct.description}</p>
              <div className="detail-note">
                <Leaf size={18} />
                <div>
                  <strong>
                    {selectedProduct.category === "Accessories"
                      ? "Design details"
                      : "The aromatic profile"}
                  </strong>
                  <span>{selectedProduct.flavor}</span>
                </div>
              </div>
              <div className="detail-note">
                <Sparkles size={18} />
                <div>
                  <strong>
                    {selectedProduct.category === "Accessories"
                      ? "In your setup"
                      : "The mood"}
                  </strong>
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
                    if (ageAcknowledged) setModal(null);
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
              18<span>+</span>
            </span>
            <span className="eyebrow">GOOD THINGS. FOR GROWN-UPS.</span>
            <h2>
              Good things
              <br />
              come with age.
            </h2>
            <p>
              Loud + Cana is for adults 18 and older.
              <br />
              Please confirm you are 18 or older to explore the collection.
            </p>
            <button
              className="button dark"
              onClick={() => {
                setAgeAcknowledged(true);
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
              I’m 18 or older <ArrowRight size={18} />
            </button>
            <button
              className="underage-button"
              onClick={() => {
                setPendingAdd(null);
                setModal("underage");
              }}
            >
              I’m under 18
            </button>
            <small>
              This declaration does not verify identity. An original photo ID
              must be checked before ordering.
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
              This shop is for adults 18 and older. You won’t be able to add
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
                    ? "Adults 18+ · Store-reviewed requests"
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
                  I confirm I am 18 or older. My account must have a completed
                  ID age check, and the store must confirm eligibility before
                  fulfilment.
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
                        ? "Browse products, confirm you’re 18+, and submit an order request. The store reviews eligibility and availability before accepting the request."
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
                      {live
                        ? "Enter LOUD15 in your bag for 15% off the product subtotal."
                        : "Confirmed offers will be published when online ordering opens."}
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
                    catalog. Adults 18+ only.
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
