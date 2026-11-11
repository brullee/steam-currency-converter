// Builds large synthetic Steam-like pages for the performance tests: a mix of every
// layout the extension handles, padded with plenty of non-price text (titles, tags,
// descriptions), which is what most of a real page is.
//
//   kind 0: store search row  (link with original + final price)
//   kind 1: legacy market row (.market_listing_row)
//   kind 2: beta market card  (cursor:pointer <div>, display-currency "UAH 1,205.00")
//   kind 3: beta exterior tab (cursor:pointer <div>, two locale-formatted prices)
function card(i) {
    const usd = (i % 50 + 1) + '.' + String(i % 100).padStart(2, '0');
    const noise = `<span class="tag">Action</span><span class="tag">Indie</span>
        <p class="desc">Item ${i}: a long description that is not a price, with numbers like ${i} and 2024.</p>`;
    switch (i % 4) {
        case 0: return `<a href="#" class="search_result_row" id="c${i}">
            <span class="title">Game ${i}</span>${noise}
            <div class="discount_original_price">$${usd}</div>
            <div class="discount_final_price" data-price="${i}">$${usd}</div></a>`;
        case 1: return `<div class="market_listing_row" id="c${i}">
            <span class="name">Item ${i}</span>${noise}
            <span class="normal_price" data-price="${i}">$${usd} USD</span></div>`;
        case 2: return `<div style="cursor:pointer" id="c${i}">
            <span style="cursor:pointer">Pattern Template: ${i}</span>${noise}
            <span style="cursor:pointer" data-price="${i}">UAH ${((i % 50 + 1) * 45).toLocaleString('en-US')}.00</span></div>`;
        default: return `<div style="cursor:pointer" id="c${i}">
            <span style="cursor:pointer">Minimal Wear</span>${noise}
            <span style="cursor:pointer" data-price="${i}">$${usd}</span>
            <span style="cursor:pointer">$${usd}</span></div>`;
    }
}

const cards = (from, count) => Array.from({ length: count }, (_, k) => card(from + k)).join('\n');

module.exports = { card, cards };
