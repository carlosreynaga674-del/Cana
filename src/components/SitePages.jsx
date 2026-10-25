import React from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Heart,
  Leaf,
  Mail,
  MapPin,
  MessageCircle,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
} from "lucide-react";

const gallery = [
  {
    image: "/images/reference-space-1.webp",
    title: "The welcome",
    description:
      "A bold identity, warm lighting, and a welcoming first impression.",
  },
  {
    image: "/images/reference-space-2.webp",
    title: "Room to discover",
    description:
      "Considered displays and space to explore the details at your own pace.",
  },
  {
    image: "/images/reference-space-3.webp",
    title: "Good vibes only",
    description:
      "A relaxed corner imagined for conversation, culture, and connection.",
  },
];

function PageLink({ to, onNavigate, children, className = "text-link" }) {
  const standalone =
    typeof window !== "undefined" &&
    (window.__LC_OFFLINE_PREVIEW__ === true ||
      window.location.protocol === "file:");
  return (
    <a
      href={standalone ? `#${to}` : to}
      className={className}
      onClick={(event) => {
        if (
          onNavigate &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onNavigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}

function PageIntro({ kicker, title, children }) {
  return (
    <header className="page-hero">
      <span className="page-kicker">{kicker}</span>
      <h1 className="page-title">{title}</h1>
      <p className="page-intro">{children}</p>
    </header>
  );
}

function ShopButton({
  onBrowse,
  onNavigate,
  children = "Explore the collection",
}) {
  return (
    <button
      className="button lime"
      onClick={() => (onBrowse ? onBrowse() : onNavigate?.("/shop"))}
    >
      {children} <ArrowRight size={17} />
    </button>
  );
}

function AboutPage({ onNavigate, onBrowse, member }) {
  return (
    <div className="page-shell container about-page">
      <PageIntro
        kicker="QUALITY. CULTURE. COMMUNITY."
        title="More than cannabis."
      >
        Loud + Cana brings a distinctly South African point of view to cannabis
        culture. A place for personal taste, thoughtful discovery, and good
        conversation.
      </PageIntro>
      <section className="page-split">
        <figure className="page-image">
          <img
            src="/images/reference-hero.webp"
            alt="Black and lime Loud + Cana store design concept"
            loading="lazy"
          />
          <figcaption>THE LOUD +CANA VISION · STORE DESIGN CONCEPT</figcaption>
        </figure>
        <div className="page-feature">
          <span className="page-kicker">OUR POINT OF VIEW</span>
          <h2>Your own kind of good.</h2>
          <p>
            There is no single way to be part of a culture. We believe
            curiosity, individuality, and clear information belong in the same
            space.
          </p>
          <p>
            Explore the collection, learn about different formats, and save the
            details that catch your eye. Your choices should feel like your own.
          </p>
          <div className="page-actions">
            <ShopButton onBrowse={onBrowse} onNavigate={onNavigate} />
            <PageLink to="/our-space" onNavigate={onNavigate}>
              Discover our space <ArrowUpRight size={16} />
            </PageLink>
          </div>
        </div>
      </section>
      <section
        className="page-section"
        aria-label="What matters to Loud and Cana"
      >
        <div className="page-grid page-card-grid">
          <article className="page-card">
            <Leaf className="page-icon" size={28} />
            <h2>Choice with character.</h2>
            <p>
              Discover flower, pre-rolls, edibles, vapes, drinks, and
              accessories. Explore the format and read the details before
              choosing.
            </p>
          </article>
          <article className="page-card">
            <Users className="page-icon" size={28} />
            <h2>Room for you.</h2>
            <p>
              Create a free member account to keep your favourites together and
              return to them when you sign in on another device.
            </p>
            <PageLink
              to={member ? "/account" : "/membership"}
              onNavigate={onNavigate}
            >
              {member ? "Your member account" : "Meet the membership"}{" "}
              <ArrowRight size={16} />
            </PageLink>
          </article>
          <article className="page-card">
            <BookOpen className="page-icon" size={28} />
            <h2>Clarity comes first.</h2>
            <p>
              Make informed choices. Product information, potency, availability,
              and eligibility should be confirmed before any purchase.
            </p>
            <PageLink to="/responsible-use" onNavigate={onNavigate}>
              Read the essentials <ArrowRight size={16} />
            </PageLink>
          </article>
        </div>
      </section>
    </div>
  );
}

function SpacePage({ onGallery, onNavigate, store }) {
  return (
    <div className="page-shell container space-page">
      <PageIntro
        kicker="THE LOUD +CANA EXPERIENCE"
        title="A space with its own energy."
      >
        Black, lime, warm light, and a little room to slow down. Explore the
        visual direction behind the Loud + Cana experience.
      </PageIntro>
      <div className="page-gallery">
        {gallery.map((item, index) => (
          <button
            className="page-gallery-card"
            key={item.title}
            onClick={() => onGallery?.(index)}
            aria-label={`Open gallery image: ${item.title}`}
          >
            <img
              src={item.image}
              alt={`${item.title} — Loud + Cana store concept`}
              loading="lazy"
            />
            <span className="page-gallery-copy">
              <strong>
                {item.title} <ArrowUpRight size={18} />
              </strong>
              <span>{item.description}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="page-note">
        These images show the store design concept. They do not confirm a retail
        location, current store layout, or opening hours.
      </p>
      <section className="page-callout">
        <div>
          <MapPin className="page-icon" size={27} />
          <h2>Rooted in Gauteng.</h2>
          <p>
            {store?.pickupAddress
              ? "Find the business-supplied location and contact details on our contact page. Confirm arrangements before visiting."
              : "Confirmed visit and pickup details will be published on the contact page when available."}
          </p>
        </div>
        <PageLink
          to="/contact"
          onNavigate={onNavigate}
          className="button outline"
        >
          Contact & location <ArrowRight size={17} />
        </PageLink>
      </section>
    </div>
  );
}

function ContactPage({ store, onNavigate }) {
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(store?.contactEmail || "")
    ? store.contactEmail
    : "";
  const address =
    typeof store?.pickupAddress === "string" ? store.pickupAddress.trim() : "";
  const postalCodes = Array.isArray(store?.deliveryZips)
    ? store.deliveryZips
    : [];
  return (
    <div className="page-shell container contact-page">
      <PageIntro kicker="LET’S TALK" title="Good conversations start here.">
        Questions about your account, the collection, or an order request? Find
        the available contact details and service information below.
      </PageIntro>
      <div className="contact-grid page-grid">
        <section className="contact-card page-card">
          <Mail className="page-icon" size={30} />
          <h2>Email the store.</h2>
          <p>
            {email
              ? "Use the business-supplied email address for product questions, account assistance, or an existing request."
              : "A public customer-support email has not yet been configured. It will appear here when supplied by the business."}
          </p>
          {email ? (
            <>
              <a className="contact-detail" href={`mailto:${email}`}>
                {email}
              </a>
              <a className="button lime" href={`mailto:${email}`}>
                Open email app <ArrowUpRight size={17} />
              </a>
              <small className="page-note">
                Opens your email app. No message is sent automatically.
              </small>
            </>
          ) : (
            <PageLink to="/help" onNavigate={onNavigate}>
              Browse common questions <ArrowRight size={16} />
            </PageLink>
          )}
        </section>
        <section className="contact-card page-card">
          <MapPin className="page-icon" size={30} />
          <h2>Location & visits.</h2>
          <p>{store?.jurisdiction || "Gauteng, South Africa"}</p>
          {address ? (
            <>
              <p className="contact-detail">{address}</p>
              <a
                className="button outline"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                target="_blank"
                rel="noreferrer"
              >
                View address on maps <ArrowUpRight size={17} />
              </a>
              <small className="page-note">
                Confirm pickup arrangements with the store before travelling.
              </small>
            </>
          ) : (
            <p>
              The store address and visiting arrangements have not yet been
              announced.
            </p>
          )}
        </section>
        <section className="contact-card page-card">
          <ShoppingBag className="page-icon" size={30} />
          <h2>Delivery coverage.</h2>
          {postalCodes.length ? (
            <>
              <p>Postal codes currently configured by the business:</p>
              <ul className="postal-code-list">
                {postalCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              Delivery postal codes have not yet been confirmed. A saved
              postal-code preference does not establish service availability.
            </p>
          )}
          <p>
            {store?.mode === "live"
              ? "Requests are reviewed by the store. Availability and timing are confirmed after review."
              : "Online order requests are not currently open."}
          </p>
          <PageLink to="/help" onNavigate={onNavigate}>
            Ordering information <ArrowRight size={16} />
          </PageLink>
        </section>
      </div>
      <section className="page-callout">
        <div>
          <MessageCircle className="page-icon" size={27} />
          <h2>A little guidance?</h2>
          <p>
            Find answers about membership, saved favourites, product
            information, and private order tracking.
          </p>
        </div>
        <PageLink to="/help" onNavigate={onNavigate} className="button outline">
          Visit the help centre <ArrowRight size={17} />
        </PageLink>
      </section>
    </div>
  );
}

function PrivacyPage({ onNavigate, store = {} }) {
  return (
    <div className="page-shell container legal-page">
      <PageIntro kicker="YOUR INFORMATION" title="Privacy, explained.">
        How information is used by this website and its member and order
        services.
      </PageIntro>
      <div className="page-prose legal-content">
        <section className="legal-section">
          <h2>Your member account</h2>
          <p>
            When you create an account, the service stores your name, email
            address, password hash, account creation time, saved favourites, and
            your age and terms acknowledgements. Passwords are hashed with a
            unique salt; the service does not store your original password.
          </p>
          <p>
            Your date of birth is checked against the 18-year adult threshold
            using the South African date. A declaration and awareness quiz do
            not prove identity. New accounts remain pending until authorised
            staff review the uploaded ID photograph and selfie against the full
            name and declared date of birth. This is manual photo comparison;
            it does not establish liveness or automatically authenticate a
            document. Email ownership is not independently verified.
            Membership is a free account, not a paid subscription.
          </p>
        </section>
        <section className="legal-section">
          <h2>Date of birth and ID age checks</h2>
          <p>
            We use your birth date only to assess adult eligibility and support
            the staff ID check you request. Applicants under 18 cannot create an
            account; their birth date is not saved as a member record. Pending
            dates are removed after a review or when the 30-day submission
            expires. An expired application needs a fresh check.
          </p>
          <p>
            New applicants submit an ID photograph and a selfie through the
            private upload form, with separate consent. A document photograph
            may contain its document number and other personal details. Do not
            enter these in notes or send documents by email or the contact form.
            Images are encrypted in server storage and accessible only to
            authorised staff reviewing the application. They are removed from
            active storage after approval, rejection, or seven days pending.
            The check's outcome, timestamps, and staff audit reference remain.
            Backups have a separate retention process. A name change requires
            a new check. Questions do not verify age or identity.
          </p>
          <p>
            You can stop before submitting or close your account later. If you
            decline the necessary private document and selfie processing, ID verification and
            order submission are unavailable. Browsing does not require an ID
            upload.
          </p>
        </section>
        <section className="legal-section">
          <h2>Account welcome emails</h2>
          <p>
            Creating an account queues a transactional welcome email. When the
            business has connected its sending account, the sending service
            receives your email address, first name, and account-service message.
            Identity photographs, date of birth, document numbers, and passwords
            are not included. This does not subscribe you to marketing or verify
            ownership of your email address.
          </p>
        </section>
        <section className="legal-section">
          <h2>Sign-in cookies</h2>
          <p>
            The server uses an HttpOnly session cookie to keep you signed in.
            Member sessions can last up to 30 days unless you sign out, change
            your password, delete your account, or the session expires.
            Production cookies use Secure and SameSite protections. Staff access
            uses a separate session.
          </p>
        </section>
        <section className="legal-section">
          <h2>Information on this device</h2>
          <p>
            Your selection, age confirmation, postal-code preference, and recent
            private order tracking details may be stored in this browser. Guest
            favourites stay on the device. When signed in, member favourites are
            associated with your account so they can be restored on another
            device.
          </p>
          <p>
            Clearing browser storage removes local details. Signing out ends the
            current member session; it does not automatically erase all browser
            preferences.
          </p>
        </section>
        <section className="legal-section">
          <h2>Order requests</h2>
          <p>
            When order intake is enabled, submitted requests include contact
            information, delivery or pickup details, selected items, totals, and
            notes. Authorised staff use this information to review and fulfil
            requests. A private tracking token provides access to an individual
            request; keep tracking links private.
          </p>
          <p>
            No online payment details are collected by this application. There
            is no connected automated ID-verification or driver-dispatch
            provider.
          </p>
        </section>
        <section className="legal-section">
          <h2>Account changes and deletion</h2>
          <p>
            You can edit your profile, change your password, and manage your
            member account from the account page. Account deletion removes the
            member profile, saved favourites, age-check information, and sign-in
            sessions. An authorised administrator can also delete your member
            account. Deletion removes linked unsent welcome-email jobs; messages
            already in flight or accepted by the sending service cannot be
            recalled. Backups and the sending service's records have separate
            retention processes. Existing order records are separate business records and
            may require a retention or deletion review by the business.
          </p>
          <PageLink to="/account" onNavigate={onNavigate}>
            Manage your account <ArrowRight size={16} />
          </PageLink>
        </section>
        <section className="legal-section">
          <h2>Privacy requests</h2>
          <p>
            {store.businessName || "Loud + Cana"} is responsible for the member
            information it processes. The operating address and public contact
            details are on the contact page. Use those details to request
            access, correction, or deletion, or to ask about retention and
            hosting operators. Hosting may involve processing outside South
            Africa; ask the business about its applicable transfer safeguards.
            You may also raise a concern with South Africa's Information
            Regulator.
          </p>
          <PageLink to="/contact" onNavigate={onNavigate}>
            Contact the business <ArrowRight size={16} />
          </PageLink>
        </section>
      </div>
    </div>
  );
}

function TermsPage({ onNavigate }) {
  return (
    <div className="page-shell container legal-page">
      <PageIntro kicker="WEBSITE & MEMBERSHIP" title="Terms of use.">
        Clear expectations for browsing, member accounts, and any order
        requests.
      </PageIntro>
      <div className="page-prose legal-content">
        <section className="legal-section">
          <h2>Adults 18 and older</h2>
          <p>
            This website is intended for adults aged 18 or older. Signup checks
            your declared date of birth and includes random awareness questions.
            These steps do not prove identity. Your account's ID status remains
            pending until staff review the required ID photograph and selfie. A
            verified adult account is required for an order request, and the
            business must separately confirm lawful eligibility and
            availability.
          </p>
        </section>
        <section className="legal-section">
          <h2>Member accounts</h2>
          <p>
            Basic website membership is free. Use accurate account information,
            choose a unique password, and keep sign-in details private. Do not
            access another person's account or use the service to interfere with
            the website, other members, or the business.
          </p>
          <p>
            Account features currently include a member profile and saved
            favourites. No paid subscription, loyalty points, guaranteed
            discounts, exclusive stock, or event access is included unless
            separately announced with actual terms.
          </p>
        </section>
        <section className="legal-section">
          <h2>Product information</h2>
          <p>
            Catalog entries, images, descriptions, and prices may be
            illustrative or indicative until approved by the business. Confirm
            the actual product, packaging, potency, price, availability, and
            authorisation before any purchase. Store concept imagery does not
            establish an operating retail location.
          </p>
          <p>
            Product information is not medical advice or a claim to diagnose,
            treat, or prevent a condition.
          </p>
        </section>
        <section className="legal-section">
          <h2>Requests and fulfilment</h2>
          <p>
            Where order intake is enabled, submitting a request does not
            automatically confirm acceptance, stock, delivery time, or payment.
            The store reviews eligibility and availability before accepting and
            fulfilling a request. Only configured service areas are supported.
          </p>
          <p>
            This application does not collect online payments or automatically
            verify identity or dispatch a driver. The business must communicate
            its actual payment, cancellation, refund, and fulfilment
            arrangements before accepting a transaction.
          </p>
        </section>
        <section className="legal-section">
          <h2>Lawful and responsible use</h2>
          <p>
            Use the website and any products in accordance with applicable law.
            Private-use permission does not by itself establish authorisation
            for commercial sales or delivery. An account does not confer sales
            or purchase authorisation.
          </p>
          <PageLink to="/responsible-use" onNavigate={onNavigate}>
            Read responsible-use guidance <ArrowRight size={16} />
          </PageLink>
        </section>
        <section className="legal-section">
          <h2>Questions about these terms</h2>
          <p>
            Contact the business for clarification about current products,
            service availability, privacy, or an existing request. These terms
            describe the current website features; the business is responsible
            for reviewing its actual operating and consumer policies.
          </p>
          <PageLink to="/contact" onNavigate={onNavigate}>
            Contact & service information <ArrowRight size={16} />
          </PageLink>
        </section>
      </div>
    </div>
  );
}

function ResponsiblePage({ onNavigate }) {
  return (
    <div className="page-shell container responsible-page">
      <PageIntro
        kicker="MAKE AN INFORMED CHOICE"
        title="Good culture. Responsible choices."
      >
        Cannabis affects people differently. Read the information, understand
        the format, and put your wellbeing and the people around you first.
      </PageIntro>
      <div className="page-grid page-card-grid">
        <article className="page-card">
          <ShieldCheck className="page-icon" size={28} />
          <h2>For adults only.</h2>
          <p>
            Loud + Cana is for adults 18 and older. Keep products secured and
            out of reach of children and pets. An age tick box is not an
            identity check.
          </p>
        </article>
        <article className="page-card">
          <BookOpen className="page-icon" size={28} />
          <h2>Read the label.</h2>
          <p>
            Confirm actual contents, potency, portion information, and
            manufacturer guidance. Do not assume that a product image or strain
            name describes the effects you will experience.
          </p>
        </article>
        <article className="page-card">
          <Heart className="page-icon" size={28} />
          <h2>Consider your wellbeing.</h2>
          <p>
            Avoid cannabis during pregnancy or breastfeeding. If you take
            medication or have a health condition, ask a qualified healthcare
            professional before use.
          </p>
        </article>
      </div>
      <section className="page-section page-prose">
        <h2>Adult access and South African guidance.</h2>
        <p>
          South African government guidance defines adults as people aged 18 or
          older. Permission for private adult use does not itself authorise
          buying, selling, or commercial delivery. Membership and passing our
          awareness questions do not change those rules or prove identity.
        </p>
        <p>
          New members upload an ID photograph and a selfie for private staff
          review. Staff compare the photographs and check the name and adult
          birth date. This does not provide automated face matching or liveness
          detection. Older accounts may still require an original-ID check in
          person. Use only the private verification form for document images.
        </p>
        <a
          href="https://www.gov.za/news/media-statements/justice-and-constitutional-development-draft-regulations-under-cannabis"
          target="_blank"
          rel="noreferrer"
          className="text-link"
        >
          Read the government guidance <ArrowUpRight size={16} />
        </a>
        <h2>Understand the format.</h2>
        <p>
          Edibles and infused drinks can take longer to have an effect and can
          last longer than expected. Do not take more while waiting for an
          effect. Check the actual package instructions and allow time to
          understand your response.
        </p>
        <h2>Plan ahead.</h2>
        <p>
          Do not drive, operate machinery, or undertake safety-critical tasks
          after use. Avoid mixing cannabis with alcohol or other intoxicants. Be
          mindful of shared spaces and people who have not chosen to
          participate.
        </p>
        <h2>Ask questions.</h2>
        <p>
          If product information or potency is unclear, seek clarification
          before using it. If you feel unwell or someone may have consumed a
          product accidentally, seek appropriate medical help.
        </p>
        <div className="page-actions">
          <PageLink
            to="/help"
            onNavigate={onNavigate}
            className="button outline"
          >
            Explore common questions <ArrowRight size={17} />
          </PageLink>
        </div>
      </section>
    </div>
  );
}

function HelpPage({ store, onNavigate }) {
  const live = store?.mode === "live";
  const questions = [
    [
      "How do I create a member account?",
      <>
        Choose Membership, then create a free account using your name, email
        address, and a password of at least 12 characters. Provide your date of
        birth, confirm you are 18 or older, accept the age-check notice, and
        answer three randomly selected awareness questions. Your account can
        save favourites while its private ID-and-selfie review is pending.{" "}
        <PageLink to="/signup" onNavigate={onNavigate}>
          Create an account <ArrowRight size={15} />
        </PageLink>
      </>,
    ],
    [
      "What does membership include?",
      <>
        Your account gives you a member profile and saved favourites across
        devices. It is currently free. Paid subscriptions, points, discounts,
        and events are not included.{" "}
        <PageLink to="/membership" onNavigate={onNavigate}>
          Explore membership <ArrowRight size={15} />
        </PageLink>
      </>,
    ],
    [
      "How do I save products?",
      "Tap the heart on a product to add it to your favourites. Guest favourites are saved on the current browser. Sign in to keep your member favourites with your account and access them on another device.",
    ],
    [
      "How do I change my account details or password?",
      <>
        Open your account after signing in to edit your name or change your
        password. A password change requires your current password. If you
        cannot sign in, use the business contact details for assistance; this
        site does not currently send password-reset emails.{" "}
        <PageLink to="/account" onNavigate={onNavigate}>
          Your account <ArrowRight size={15} />
        </PageLink>
      </>,
    ],
    [
      "Can I place an order now?",
      live
        ? "Order requests are enabled. Browse the collection, confirm your age, choose delivery or pickup, and submit your details. The store reviews the request before accepting it. The website does not collect online payment."
        : "Online order intake is not currently open. You can explore products, save favourites, and build a personal selection. No order or payment is submitted from the catalog.",
    ],
    [
      "Where is delivery available?",
      live
        ? "Delivery is limited to the postal codes configured by the store. The current delivery charge is R49, waived on a product subtotal of R750 or more; pickup has no delivery charge. Timing and availability are confirmed after store review."
        : "The store must confirm its service areas before ordering opens. A postal code saved in your browser is a preference, not a delivery-availability confirmation.",
    ],
    [
      "How do I track an existing request?",
      "A real request has a private tracking link after submission. Use the link to view that request across devices. Keep it private: order numbers alone can only be looked up from the browser that holds the tracking details. A member account does not automatically give access to all requests associated with an email address.",
    ],
    [
      "Are product prices and potency confirmed?",
      "Product details, packaging images, prices, potency, and stock require confirmation by the business. Read the actual package label and ask the store about anything that is unclear. Product descriptions are not medical advice.",
    ],
  ];
  return (
    <div className="page-shell container help-page">
      <PageIntro
        kicker="THE HELP CENTRE"
        title="A little clarity goes a long way."
      >
        Find answers about your account, the collection, saved favourites, and
        the way order requests work.
      </PageIntro>
      <div className="faq-list">
        {questions.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <ChevronDown size={19} aria-hidden="true" />
            </summary>
            <div className="faq-answer">{answer}</div>
          </details>
        ))}
      </div>
      <section className="page-callout">
        <div>
          <MessageCircle className="page-icon" size={27} />
          <h2>Still have a question?</h2>
          <p>
            Find the available business contact details and current service
            information.
          </p>
        </div>
        <PageLink
          to="/contact"
          onNavigate={onNavigate}
          className="button outline"
        >
          Contact the store <ArrowRight size={17} />
        </PageLink>
      </section>
    </div>
  );
}

function NotFoundPage({ onNavigate, onBrowse }) {
  return (
    <div className="page-shell container not-found-page">
      <Sparkles className="page-icon" size={40} />
      <PageIntro
        kicker="404 · PAGE NOT FOUND"
        title="Let’s find your way back."
      >
        This page may have moved, or the address may be incomplete. The
        collection and the rest of Loud + Cana are a click away.
      </PageIntro>
      <div className="page-actions">
        <PageLink to="/" onNavigate={onNavigate} className="button outline">
          Back to home <ArrowRight size={17} />
        </PageLink>
        <ShopButton onBrowse={onBrowse} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export function PageContent({
  page,
  onNavigate,
  onBrowse,
  onGallery,
  onHelp,
  store = {},
  member,
}) {
  const props = { onNavigate, onBrowse, onGallery, onHelp, store, member };
  switch (page) {
    case "about":
      return <AboutPage {...props} />;
    case "our-space":
      return <SpacePage {...props} />;
    case "contact":
      return <ContactPage {...props} />;
    case "privacy":
      return <PrivacyPage {...props} />;
    case "terms":
      return <TermsPage {...props} />;
    case "responsible-use":
      return <ResponsiblePage {...props} />;
    case "help":
      return <HelpPage {...props} />;
    default:
      return <NotFoundPage {...props} />;
  }
}

export default PageContent;
