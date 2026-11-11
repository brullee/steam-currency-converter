// Every Steam class name and id the extension relies on, in one place.
//
// Steam renames these without notice (the beta market hashes its class names on every
// build), so the rule is: nothing here is needed to convert prices. The text walker
// finds prices by their text, hover groups fall back to links / buttons / clickable
// elements, and the beta market dialogs are found by element type (<dialog>, <form>).
// Each entry below only improves one page, and its code does nothing when it stops
// matching. `npm run test:live` reports the public-page entries that no longer match.
const STEAM = {
    // Prices injected by other extensions (Augmented Steam, IsThereAnyDeal): left alone.
    otherExtensions: '.itad-pricing, .es_regional',

    // Hover groups: hovering anywhere in one shows the original of every price in it.
    // Without them, hover still groups by the enclosing link / button / clickable card.
    hoverGroups: [
        '.market_listing_row, .market_commodity_order_summary',   // legacy market rows
        '.game_purchase_action_bg, .game_purchase_action',        // store app page purchase box
        '.tab_item',                                              // store front page tabs
    ].join(', '),
    // A role=button that only wraps the discount badge, not the whole card.
    notAHoverGroup: '.discount_block',
    // New store UI: the sale badge's parent holds both the original and final price.
    saleBox: '.StoreSaleDiscountBox',

    // Legacy market price-history graph tooltips (jqplot), rewritten on every mouse move.
    graphTooltip: '.jqplot-highlighter-tooltip, .jqplot-cursor-tooltip',

    // Legacy market (the non-beta UI) and wallet balances.
    marketWallet:       'marketWalletBalanceAmount',
    headerWallet:       'header_wallet_balance',
    sellReceiveInput:   'market_sell_currency_input',
    sellBuyerInput:     'market_sell_buyercurrency_input',
    sellInputGroup:     '.market_sell_dialog_input_group',
    graphZoomControls:  '.pricehistory_zoom_controls',
    buyOrderTotal:      'market_buy_commodity_order_total',
    buyOrderPrice:      'market_buy_commodity_input_price',
    buyOrderRow:        'market_buy_commodity_input_row',
    buyOrderInputCol:   'market_buy_commodity_input',
    buyOrderLabelCol:   'market_buy_commodity_input_label',
    buyOrderWallet:     'market_buyorder_dialog_walletbalance',
    buyOrderWalletAmt:  'market_buyorder_dialog_walletbalance_amount',

    // Beta market (React): no class names at all, only element types.
    betaDialog: 'dialog[open]',
};
