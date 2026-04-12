const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Registry of all supported Steam wallet currencies according to SteamDB.
// symbol       — character(s) Steam displays for this currency
// position     — whether the symbol appears before or after the number
// numberFormat — BCP 47 tag controlling decimal/thousands separators in output
const CURRENCIES = {
    // symbol-after currencies
    UAH: { symbol: '\u20B4',  position: 'after',  numberFormat: 'uk-UA' },  // 63₴
    RUB: { symbol: '\u0440\u0443\u0431.', position: 'after', numberFormat: 'ru-RU' }, // 1100 руб.
    KZT: { symbol: '\u20B8',  position: 'after',  numberFormat: 'kk-KZ' },  // 782₸
    EUR: { symbol: '\u20AC',  position: 'after',  numberFormat: 'de-DE' },  // 2,64€
    PLN: { symbol: 'z\u0142', position: 'after',  numberFormat: 'pl-PL' },  // 12,57zł
    NOK: { symbol: 'kr',      position: 'after',  numberFormat: 'nb-NO' },  // 30,26 kr
    AED: { symbol: 'AED',     position: 'after',  numberFormat: 'ar-AE' },  // 8.16 AED
    QAR: { symbol: 'QR',      position: 'after',  numberFormat: 'en-QA' },  // 6.79 QR
    KWD: { symbol: 'KD',      position: 'after',  numberFormat: 'en-KW' },  // 0.56 KD
    SAR: { symbol: 'SR',      position: 'after',  numberFormat: 'en-SA' },  // 6.29 SR
    VND: { symbol: '\u20AB',  position: 'after',  numberFormat: 'vi-VN' },  // 312.000₫
    // symbol-before currencies
    USD: { symbol: '$',       position: 'before', numberFormat: 'en-US' },  // $3.00
    GBP: { symbol: '\u00A3',  position: 'before', numberFormat: 'en-GB' },  // £2.27
    CHF: { symbol: 'CHF',     position: 'before', numberFormat: 'de-CH' },  // CHF 3.05
    AUD: { symbol: 'A$',      position: 'before', numberFormat: 'en-AU' },  // A$ 4.00
    CAD: { symbol: 'CDN$', altSymbol: 'C$', position: 'before', numberFormat: 'en-CA' }, // CDN$ 3.56 or C$ 3.56
    NZD: { symbol: 'NZ$',     position: 'before', numberFormat: 'en-NZ' },  // NZ$ 4.00
    SGD: { symbol: 'S$',      position: 'before', numberFormat: 'en-SG' },  // S$2.89
    HKD: { symbol: 'HK$',     position: 'before', numberFormat: 'en-HK' },  // HK$ 17.68
    UYU: { symbol: '$U',      position: 'before', numberFormat: 'es-UY' },  // $U84
    KRW: { symbol: '\u20A9',  position: 'before', numberFormat: 'ko-KR' },  // ₩ 3,030
    MXN: { symbol: 'Mex$',    position: 'before', numberFormat: 'es-MX' },  // Mex$34.33
    COP: { symbol: 'COL$',    position: 'before', numberFormat: 'es-CO' },  // COL$ 7140
    JPY: { symbol: '\u00A5',  position: 'before', numberFormat: 'ja-JP' },  // ¥ 312
    PEN: { symbol: 'S/.',     position: 'before', numberFormat: 'es-PE' },  // S/.6.46
    THB: { symbol: '\u0E3F',  position: 'before', numberFormat: 'th-TH' },  // ฿60.86
    MYR: { symbol: 'RM',      position: 'before', numberFormat: 'ms-MY' },  // RM7.39
    CLP: { symbol: 'CLP$',    position: 'before', numberFormat: 'es-CL' },  // CLP$ 1598
    BRL: { symbol: 'R$',      position: 'before', numberFormat: 'pt-BR' },  // R$ 9,00
    ZAR: { symbol: 'R', requireDecimal: true, position: 'before', numberFormat: 'en-ZA' }, // R 27.88
    CRC: { symbol: '\u20A1',  position: 'before', numberFormat: 'es-CR' },  // ₡1.275
    TWD: { symbol: 'NT$',     position: 'before', numberFormat: 'zh-TW' },  // NT$ 51
    PHP: { symbol: '\u20B1', altSymbol: 'P', position: 'before', numberFormat: 'fil-PH' }, // ₱93.48 or P93.48 (Steam uses both)
    IDR: { symbol: 'Rp',      position: 'before', numberFormat: 'id-ID' },  // Rp 25160
    INR: { symbol: '\u20B9',  position: 'before', numberFormat: 'en-IN' },  // ₹ 136
};
