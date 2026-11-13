"""Fake data so the dashboard can be previewed without real credentials (DEMO=1)."""
import random
import time

STOCKS = [
    ("RELIANCE", "NSE", 2890.0), ("TCS", "NSE", 4120.0), ("HDFCBANK", "NSE", 1690.0),
    ("INFY", "NSE", 1820.0), ("ITC", "NSE", 462.0), ("TATAMOTORS", "NSE", 985.0),
    ("SBIN", "NSE", 812.0), ("ICICIBANK", "NSE", 1215.0), ("ASIANPAINT", "NSE", 2410.0),
    ("BAJFINANCE", "NSE", 7150.0), ("LT", "NSE", 3640.0), ("SUNPHARMA", "NSE", 1725.0),
    ("TITAN", "NSE", 3310.0), ("HINDUNILVR", "NSE", 2380.0), ("MARUTI", "NSE", 12450.0),
    ("ZOMATO", "NSE", 245.0), ("IRFC", "NSE", 142.0), ("GOLDBEES", "NSE", 68.5),
    ("NIFTYBEES", "NSE", 262.0), ("RPTECH", "NSE", 420.0),
]

DEMO_ACCOUNTS = [
    {"id": "demo1", "name": "Asha", "user_id": "AB1234", "color": 1},
    {"id": "demo2", "name": "Ravi", "user_id": "CD5678", "color": 2},
    {"id": "demo3", "name": "Papa", "user_id": "EF9012", "color": 3},
    {"id": "demo4", "name": "Mummy", "user_id": "GH3456", "color": 4},
    {"id": "demo5", "name": "Neha", "user_id": "IJ7890", "color": 5},
]


def snapshot(acc: dict) -> dict:
    rnd = random.Random(acc["id"] + str(int(time.time() // 60)))
    picks = rnd.sample(STOCKS, rnd.randint(6, 13))
    holdings = []
    for sym, exch, px in picks:
        qty = rnd.choice([5, 10, 12, 25, 40, 60, 100, 150, 300])
        avg = px * rnd.uniform(0.62, 1.18)
        close = px * rnd.uniform(0.985, 1.015)
        last = close * rnd.uniform(0.975, 1.025)
        holdings.append({
            "tradingsymbol": sym, "exchange": exch, "isin": "INE" + sym[:6].ljust(6, "0") + "01",
            "quantity": qty, "t1_quantity": 0, "average_price": round(avg, 2),
            "last_price": round(last, 2), "close_price": round(close, 2),
            "pnl": round((last - avg) * qty, 2),
            "day_change": round(last - close, 2),
            "day_change_percentage": round((last - close) / close * 100, 2),
            "product": "CNC",
        })
    net_positions = []
    if rnd.random() < 0.6:
        sym, exch, px = rnd.choice(STOCKS[:8])
        q = rnd.choice([10, 25, 50])
        last = px * rnd.uniform(0.99, 1.01)
        net_positions.append({
            "tradingsymbol": sym, "exchange": exch, "product": "MIS", "quantity": q,
            "average_price": round(px, 2), "last_price": round(last, 2),
            "pnl": round((last - px) * q, 2), "m2m": round((last - px) * q, 2),
        })
    orders = []
    for i in range(rnd.randint(0, 4)):
        sym, exch, px = rnd.choice(STOCKS)
        orders.append({
            "order_id": f"2411{rnd.randint(10000000, 99999999)}", "tradingsymbol": sym, "exchange": exch,
            "transaction_type": rnd.choice(["BUY", "SELL"]), "quantity": rnd.choice([5, 10, 20]),
            "filled_quantity": 0, "price": round(px * 0.99, 2), "average_price": 0,
            "status": rnd.choice(["OPEN", "COMPLETE", "REJECTED", "CANCELLED"]),
            "order_type": "LIMIT", "product": "CNC",
            "order_timestamp": time.strftime("%Y-%m-%d ") + f"{9 + i:02d}:{rnd.randint(10, 59)}:12",
        })
    cash = round(rnd.uniform(4000, 180000), 2)
    mf = []
    if rnd.random() < 0.5:
        mf.append({"fund": "Parag Parikh Flexi Cap Direct Growth", "quantity": 812.33,
                   "average_price": 61.2, "last_price": 78.9, "pnl": round((78.9 - 61.2) * 812.33, 2)})
    return {
        "fetched_at": time.time(),
        "profile": {"user_id": acc["user_id"], "user_name": acc["name"].upper() + " DEMO",
                    "email": "demo@example.com", "broker": "ZERODHA"},
        "holdings": holdings,
        "positions": {"net": net_positions, "day": net_positions},
        "margins": {"equity": {"net": cash, "available": {"cash": cash, "live_balance": cash,
                                                             "opening_balance": cash},
                               "utilised": {"debits": 0}}},
        "orders": orders,
        "mf": mf,
    }


def quote(symbol: str, holding: dict | None) -> dict:
    if holding:
        return {"last_price": holding["last_price"], "close_price": holding["close_price"], "source": "holdings"}
    rnd = random.Random(symbol + str(int(time.time() // 60)))
    base = next((px for s, _, px in STOCKS if s == symbol), rnd.uniform(100, 3000))
    close = base * rnd.uniform(0.99, 1.01)
    return {"last_price": round(close * rnd.uniform(0.975, 1.025), 2), "close_price": round(close, 2), "source": "demo"}
