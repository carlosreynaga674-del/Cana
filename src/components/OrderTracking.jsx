import React from "react";
import {
  Check,
  Clock3,
  PackageCheck,
  ShoppingBag,
  Truck,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import { formatMoney } from "../lib/order.js";
import { trackingLink } from "../lib/api.js";

export default function OrderTracking({
  order,
  confirmation,
  onContinue,
  onLookup,
  onRefresh,
  refreshing,
  error,
}) {
  const isLive = order.serverBacked;
  const steps = [
    {
      status: "pending",
      title: "Request received",
      note: "Waiting for store review.",
      icon: Clock3,
    },
    {
      status: "confirmed",
      title: "Request accepted",
      note: "The store has reviewed your request.",
      icon: Check,
    },
    {
      status: "preparing",
      title: "Getting things ready",
      note: "Picked with a little extra care.",
      icon: ShoppingBag,
    },
    {
      status:
        order.mode === "delivery" ? "out_for_delivery" : "ready_for_pickup",
      title:
        order.mode === "delivery" ? "Out for delivery" : "Ready for pickup",
      note:
        order.mode === "delivery"
          ? "Your order is with the delivery team."
          : "Bring your valid ID to the store.",
      icon: order.mode === "delivery" ? Truck : MapPin,
    },
    {
      status: order.mode === "delivery" ? "delivered" : "completed",
      title: order.mode === "delivery" ? "Delivered" : "Collected",
      note: "Thanks for choosing Loud + Cana.",
      icon: PackageCheck,
    },
  ];
  const current = Math.max(
    0,
    steps.findIndex((step) => step.status === order.status),
  );
  const cancelled = order.status === "cancelled";
  return (
    <div className="order-dialog">
      <div className="order-confirm-icon">
        <PackageCheck size={35} />
      </div>
      <span className="eyebrow">
        {isLive ? "YOUR ORDER REQUEST" : "CLIENT PREVIEW · DEMO ORDER"}
      </span>
      <h2>
        {cancelled ? (
          <>
            This request
            <br />
            was cancelled.
          </>
        ) : confirmation ? (
          <>
            Good choice.
            <br />
            Request received.
          </>
        ) : (
          <>
            Your good.
            <br />
            One step closer.
          </>
        )}
      </h2>
      <p className="order-intro">
        {isLive
          ? `Thanks, ${order.customer.name.split(" ")[0]}. ${cancelled ? "Please contact the store if you need a hand." : "The store reviews every request before confirming fulfillment."}`
          : "Your demo order is confirmed. No real order has been sent."}
      </p>
      <div className="order-number">
        <span>ORDER NUMBER</span>
        <strong>{order.id}</strong>
        <small>
          {new Date(order.createdAt).toLocaleString("en-ZA", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </small>
      </div>
      {!cancelled && (
        <div className="order-timeline">
          {(isLive ? steps : steps.slice(1, 4)).map((step, index) => {
            const Icon = step.icon;
            const done = isLive ? index <= current : index === 0;
            return (
              <div key={step.status} className={done ? "complete" : ""}>
                <span>{done ? <Check size={15} /> : <Icon size={15} />}</span>
                <p>
                  <strong>{step.title}</strong>
                  <small>{isLive ? step.note : "Demonstration only"}</small>
                </p>
              </div>
            );
          })}
        </div>
      )}
      <div className="order-detail-list">
        {order.items.map((item, index) => (
          <div key={item.lineId || index}>
            <span>
              {item.quantity} × {item.name}
              <small>{item.size}</small>
            </span>
            <strong>{formatMoney(item.quantity * item.price)}</strong>
          </div>
        ))}
      </div>
      <div className="order-summary">
        <span>
          {order.mode === "delivery" ? "Delivery" : "Pickup"} ·{" "}
          {isLive ? "Order request" : "Demo"}
        </span>
        <strong>{formatMoney(order.totals.total)}</strong>
      </div>
      {order.mode === "delivery" && order.customer.address && (
        <p className="order-destination">
          <MapPin size={13} />
          {order.customer.address}, {order.customer.city}{" "}
          {order.customer.postcode}
        </p>
      )}
      {order.notes && <p className="order-destination">Note: {order.notes}</p>}
      {isLive && order.trackingToken && (
        <label className="tracking-link-field">
          Private tracking link
          <input
            readOnly
            aria-label="Private tracking link"
            value={trackingLink(order)}
            onFocus={(event) => event.target.select()}
          />
          <small>
            Keep this link private. It grants access to your order status.
          </small>
        </label>
      )}
      <p className="order-disclaimer">
        {isLive
          ? "No online payment was taken. The store will coordinate payment and verify eligibility before handoff."
          : "No payment was collected and no actual delivery is arranged."}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {isLive && (
        <button className="text-link" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Checking status…" : "Refresh order status"}
        </button>
      )}
      <button className="button dark" onClick={onContinue}>
        Keep the good going <ArrowUpRight size={18} />
      </button>
      <button className="text-link another-order" onClick={onLookup}>
        Look up another order
      </button>
    </div>
  );
}
