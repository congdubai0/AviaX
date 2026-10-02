import { useEffect, useState } from "react";

const products = [
  { id: "burger", name: "Burger", price: 4.99, emoji: "🍔", category: "Meals" },
  { id: "fries", name: "Fries", price: 1.49, emoji: "🍟", category: "Snacks" },
  { id: "hotdog", name: "Hotdog", price: 3.49, emoji: "🌭", category: "Meals" },
  { id: "taco", name: "Taco", price: 3.99, emoji: "🌮", category: "Meals" },
  { id: "pizza", name: "Pizza", price: 7.99, emoji: "🍕", category: "Meals" },
  { id: "donut", name: "Donut", price: 1.49, emoji: "🍩", category: "Snacks" },
  { id: "popcorn", name: "Popcorn", price: 1.99, emoji: "🍿", category: "Snacks" },
  { id: "cola", name: "Cola", price: 1.49, emoji: "🥤", category: "Drinks" },
  { id: "cake", name: "Cake", price: 10.99, emoji: "🍰", category: "Snacks" },
];

const categories = ["All", "Meals", "Snacks", "Drinks"];
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function App() {
  const [quantities, setQuantities] = useState({});
  const [category, setCategory] = useState("All");
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const telegram = window.Telegram?.WebApp;
  const insideTelegram = Boolean(telegram?.initData);

  useEffect(() => {
    if (insideTelegram) {
      telegram.ready();
      telegram.expand();
    }
  }, [insideTelegram, telegram]);

  const visibleProducts = category === "All"
    ? products
    : products.filter((product) => product.category === category);
  const orderItems = products.filter((product) => quantities[product.id] > 0);
  const totalItems = orderItems.reduce((sum, product) => sum + quantities[product.id], 0);
  const totalPrice = orderItems.reduce(
    (sum, product) => sum + product.price * quantities[product.id],
    0,
  );

  const updateQuantity = (id, change) => {
    setQuantities((current) => {
      const next = Math.max(0, (current[id] ?? 0) + change);
      return { ...current, [id]: next };
    });
  };

  const closeOrder = () => {
    setOrderOpen(false);
    setOrderComplete(false);
  };

  return (
    <main className="app-shell">
      <div className="storefront">
        <header className="store-header">
          <div className="brand-mark" aria-hidden="true">D</div>
          <div className="brand-copy">
            <h1>Durger King</h1>
            <p>Hot, fresh &amp; ready to go</p>
          </div>
          <span className="open-status"><i /> OPEN</span>
        </header>

        <nav className="category-tabs" aria-label="Menu categories">
          {categories.map((item) => (
            <button
              aria-pressed={category === item}
              className={category === item ? "category-tab is-active" : "category-tab"}
              key={item}
              onClick={() => setCategory(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>

        <section className="menu-grid" aria-label={`${category} menu`}>
          {visibleProducts.map((product) => {
            const quantity = quantities[product.id] ?? 0;

            return (
              <article className="menu-item" key={product.id}>
                <div className="food-art" aria-hidden="true">{product.emoji}</div>
                <h2>{product.name}</h2>
                <p className="product-price">{money.format(product.price)}</p>
                {quantity === 0 ? (
                  <button
                    className="add-button"
                    onClick={() => updateQuantity(product.id, 1)}
                    type="button"
                  >
                    ADD
                  </button>
                ) : (
                  <div className="quantity-control" aria-label={`${product.name} quantity`}>
                    <button
                      aria-label={`Remove one ${product.name}`}
                      onClick={() => updateQuantity(product.id, -1)}
                      type="button"
                    >
                      −
                    </button>
                    <span aria-live="polite">{quantity}</span>
                    <button
                      aria-label={`Add one ${product.name}`}
                      onClick={() => updateQuantity(product.id, 1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </div>

      <footer className="order-bar">
        <button
          className="view-order-button"
          disabled={totalItems === 0}
          onClick={() => setOrderOpen(true)}
          type="button"
        >
          <span>VIEW ORDER</span>
          {totalItems > 0 && (
            <span className="order-total">
              {totalItems} {totalItems === 1 ? "item" : "items"} · {money.format(totalPrice)}
            </span>
          )}
        </button>
      </footer>

      {orderOpen && (
        <div className="order-overlay" onClick={closeOrder} role="presentation">
          <section
            aria-labelledby="order-title"
            aria-modal="true"
            className="order-sheet"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="sheet-grab" aria-hidden="true" />
            <header className="sheet-header">
              <div>
                <p className="sheet-eyebrow">DURGER KING</p>
                <h2 id="order-title">{orderComplete ? "Order received" : "Your order"}</h2>
              </div>
              <button aria-label="Close order" className="close-button" onClick={closeOrder} type="button">
                ×
              </button>
            </header>

            {orderComplete ? (
              <div className="success-state" role="status">
                <span className="success-icon" aria-hidden="true">✓</span>
                <p>This is a demo checkout. No payment was made.</p>
                <button className="checkout-button" onClick={closeOrder} type="button">
                  BACK TO MENU
                </button>
              </div>
            ) : (
              <>
                <div className="order-list">
                  {orderItems.map((product) => (
                    <div className="order-row" key={product.id}>
                      <span className="order-food" aria-hidden="true">{product.emoji}</span>
                      <div className="order-item-copy">
                        <strong>{product.name}</strong>
                        <span>Qty {quantities[product.id]} · {money.format(product.price)} each</span>
                      </div>
                      <strong className="line-total">
                        {money.format(product.price * quantities[product.id])}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="order-summary">
                  <span>Delivery</span>
                  <span className="free-delivery">FREE</span>
                  <strong>Total</strong>
                  <strong>{money.format(totalPrice)}</strong>
                </div>
                <button className="checkout-button" onClick={() => setOrderComplete(true)} type="button">
                  PLACE DEMO ORDER · {money.format(totalPrice)}
                </button>
                <p className="demo-note">Demo only · No payment or delivery is processed</p>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
