# Taobao

**Mode**: 🔐 Browser · **Domain**: `taobao.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli taobao search <query>` | Search Taobao products |
| `opencli taobao detail <id-or-url>` | Fetch product details, including parameter information (brand, origin, dimensions, etc.) |
| `opencli taobao reviews <id>` | Fetch product reviews |
| `opencli taobao cart` | View cart items |
| `opencli taobao add-cart <id>` | Add a product to cart |

## Usage Examples

```bash
# Search products
opencli taobao search "机械键盘" --limit 5

# Pass the complete url from a search row to detail (keep every query parameter)
opencli taobao detail "<url from search>"

# Fetch product details
opencli taobao detail 827563850178

# Preserve the complete URL copied after clicking a product
opencli taobao detail "<complete URL copied after clicking a product>"

# Dry-run add to cart
opencli taobao add-cart 827563850178 --spec "红色 XL" --dry-run
```

## Prerequisites

Search preserves each product card's original link. Advertisement links may use
`click.simba.taobao.com` or `mclick.simba.taobao.com`; detail follows their redirect
in the logged-in browser and returns the full resulting product URL. Re-run search
if a link expires. Passing only an item ID may trigger abnormal-access checks.

- Chrome running and logged into taobao.com
- [Browser Bridge extension](/guide/browser-bridge) installed

## Add-to-cart confirmation

`add-cart` supports both text and compact icon-only buttons. It clicks only one
visible, enabled match and requires a new success message before reporting success.
Missing or ambiguous buttons, additional required specifications, and unconfirmed
outcomes return errors. For an unconfirmed outcome, check the cart before retrying
to avoid adding the item twice.

Product, search, review, and add-to-cart commands stop on detected login or security
verification pages. Resolve those in the browser before running another command.
