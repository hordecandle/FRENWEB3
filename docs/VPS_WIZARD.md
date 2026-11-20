# VPS wizard (getfren.netlify.app/vps)

The no-terminal path: someone pays in USDC and gets a server with Fren on it, without an account anywhere.

## Flow

1. **Server.** The buyer enters an email and picks USDC on Base or USDC on Solana.
2. **Pay.** The page shows the exact amount (the price plus a unique 0.0001 to 0.0999 USDC, such as `10.0437`), the network and Fren's address, with a QR code and an "Open in my wallet" link that fill in all three. `POST /api/vps/start` doesn't touch EQVPS: nothing is ordered before payment.
3. **Payment check.** Every status poll (at most every 8 s) reads the chain:
   - Base: `eth_getLogs` for USDC `Transfer` events to the address, from the block when the order was made, 3 blocks deep.
   - Solana: new signatures on the address's USDC token account (finalized), and the USDC balance change of each transaction.
   A transfer of exactly the order's amount pays it. If an exchange rounded the amount, the buyer pastes the transaction ID (`POST /api/vps/tx`); it counts if it sent at least the price to the address, isn't older than the order, isn't another open order's exact amount, and hasn't paid for another order. The page asks for payment within an hour; a late exact payment is still picked up for 24 hours.
4. **Order.** Fren orders the server from its EQVPS reseller balance (`POST /orders` on `b2b.eqvps.com`), hostname `fren-<order>`, Ubuntu 24.04, in Finland (`location: "fi"`), and turns auto-renew off. Before ordering it looks for that hostname, so a retry never buys a second server.
5. **Install.** When EQVPS reports the server active, a background function SSHes in as root with the first root password and runs `install.sh --server --web --lock-root`. The installer sets up Fren, the HTTPS setup page, then locks root's password and turns SSH password logins off. One automatic retry, then a "Try again" button on the same server. Right after a good install the same command asks `https://polymarket.com/api/geoblock` from the new server; the wizard keeps the answer and the "Server ready" screen says whether Polymarket takes bets from it.
6. **Setup page on the server.** AI key, then the owner's own Telegram bot (BotFather steps, or one tap when `FREN_BOT_BROKER` is set), the restricted-country question, wallets (new, or "Use my wallet backup instead" to move from another server), backup, "Start Fren".

## Where servers are, and Polymarket

Polymarket refuses new bets from IPs in its restricted list (US, UK, France, Germany and others, see `packages/core/src/regions.ts` and https://docs.polymarket.com/api-reference/geoblock). EQVPS has two locations: Germany (`de`, close-only for Polymarket) and Finland (`fi`, allowed). So new servers go to Finland.

That only fixes the server's side. The setup page also asks the owner "Do you live in a country where Polymarket is restricted?" with no default. Yes: Polymarket is close-only for them on any server (they can close bets, not open new ones). No: full access. Fren never routes around a block: a server in a blocked location still gets "Polymarket doesn't allow new bets from this machine's location", now with the country Polymarket sees and how to move.

**Moving an existing server** (for example one in Germany): order a new one on /vps, and on its setup page answer the question, then choose "Use my wallet backup instead" with the `fren-wallet-backup.json` from the first setup. Same wallets, same addresses, so the money stays where it is. Then stop the old server.

## Netlify settings

Until the required ones are set, the page says "Server setup isn't open yet" and takes no orders.

| Variable | Required | What |
| --- | --- | --- |
| `EQVPS_RESELLER_TOKEN` | yes | Reseller token (`rk_…`) from EQVPS's Partners cabinet, API / MCP page. Keep it secret. |
| `EQVPS_RESELLER_PLAN_ID` | yes | Your white-label plan's id: 2 vCPU, 2 GB RAM, 25 GB disk, 1 IPv4. Make it in the Partners cabinet. |
| `FREN_PAY_BASE_ADDRESS` | one of the two | Address that receives USDC on Base. |
| `FREN_PAY_SOLANA_ADDRESS` | one of the two | Wallet that receives USDC on Solana (the owner address, not the token account). It needs to have held USDC once, so its token account exists. |
| `FREN_PRICE_USD` | no (10) | Price in USDC for the first month. |
| `FREN_BASE_RPC` | recommended | Base RPC URL, e.g. Alchemy. Default: `https://base-rpc.publicnode.com`. |
| `FREN_SOLANA_RPC` | recommended | Solana RPC URL, e.g. Alchemy or Helius. The public default rate-limits quickly. |
| `FREN_SUPPORT_CONTACT` | recommended | Shown when something needs a human. |
| `FREN_BOT_BROKER` | no | Fren's bot broker URL, for one-tap Telegram bots on the setup page. |
| `EQVPS_LOCATION` | no (`fi`) | EQVPS location for new servers. Keep `fi`: Polymarket is close-only from `de`. The plan must include this location. |
| `EQVPS_RESELLER_API`, `FREN_INSTALL_URL` | no | Overrides for testing. |

In the EQVPS Partners cabinet, make sure the plan's locations include **Finland (fi)**, or orders will be refused. Also turn **"Notify clients by email" off**, so buyers don't get EQVPS emails, and keep enough wholesale balance for the orders you expect.

## Open items

- **Renewals.** The price covers one month and auto-renew is off, so a server stops after a month unless it is renewed (`POST /services/{id}/renew` from the reseller balance). A renew page that takes another USDC payment is the next piece.
- **Refunds.** If EQVPS refuses an order after payment, the page says so and asks the buyer to contact support; the refund is manual.
