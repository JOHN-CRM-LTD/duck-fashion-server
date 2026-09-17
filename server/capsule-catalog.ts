// A deliberately fictional, eight-style Duck Fashion demo collection.
export const capsuleColors = [
  { code: "BUR", name: "Duck Burgundy", hex: "#781b30", aliases: "burgundy maroon wine red 酒紅色 酒红色 紅色 红色" },
  { code: "CRM", name: "Chalk Cream", hex: "#f2eee5", aliases: "cream chalk white ivory off white 米白色 奶油色 白色" },
  { code: "BLK", name: "Ink Black", hex: "#232323", aliases: "ink black charcoal 黑色" },
];
export const capsuleSizes = ["S", "M", "L"] as const;
export const capsulePhotoNames: Record<string, string> = { DF01: "sweatshirt", DF02: "graphic_t_shirt", DF03: "trousers", DF04: "cap", DF05: "hoodie", DF06: "beanie", DF07: "overshirt", DF08: "shorts" };
export const capsuleItems = [
  { code: "DF01", slug: "signature-sweatshirt", name: "Signature Duck Sweatshirt", nameZh: "經典小鴨衛衣", category: "Sweatshirts", price: 329, photoColor: "Duck Burgundy", aliases: "sweatshirt crewneck sweater jumper 衛衣 卫衣 圓領 圆领", description: "Relaxed crewneck with dropped shoulders, ribbed cuffs and a small embroidered duck. Demo specification: cotton-rich brushed fleece.", sizeGuide: "S: chest 104 cm / length 64 cm; M: 112 / 68 cm; L: 120 / 72 cm. Garment measurements, relaxed unisex fit." },
  { code: "DF02", slug: "back-print-tee", name: "Duck Outline Graphic T-Shirt", nameZh: "小鴨背印圖案T恤", category: "T-Shirts", price: 189, photoColor: "Chalk Cream", aliases: "tshirt t shirt tee graphic back print short sleeve T恤 短袖 上衣", description: "Relaxed short-sleeve tee with a large duck outline and DUCK FASHION back print. Demo specification: 100% cotton jersey.", sizeGuide: "S: chest 100 cm / length 66 cm; M: 108 / 70 cm; L: 116 / 74 cm. Garment measurements, relaxed unisex fit." },
  { code: "DF03", slug: "utility-cargo-trousers", name: "Duck Utility Cargo Trousers", nameZh: "小鴨工裝長褲", category: "Trousers", price: 399, photoColor: "Ink Black", aliases: "cargo trousers pants utility long pants 工裝褲 工装裤 長褲 长裤 褲子 裤子", description: "Wide-leg cargo trousers with roomy flap pockets and a subtle duck emblem. Demo specification: cotton twill.", sizeGuide: "S: waist 70–78 cm / inseam 72 cm; M: 78–86 / 74 cm; L: 86–94 / 76 cm. Suggested body waist, relaxed unisex fit." },
  { code: "DF04", slug: "embroidered-cap", name: "Signature Duck Baseball Cap", nameZh: "小鴨刺繡棒球帽", category: "Caps", price: 149, photoColor: "Duck Burgundy", aliases: "cap baseball hat dad cap 棒球帽 鴨舌帽 鸭舌帽 帽", description: "Curved-brim six-panel cap with a small embroidered duck and adjustable back strap. Demo specification: cotton twill.", sizeGuide: "S: head circumference 52–55 cm; M: 55–58 cm; L: 58–61 cm. Each size has an adjustable strap." },
  { code: "DF05", slug: "everyday-hoodie", name: "Everyday Duck Hoodie", nameZh: "日常小鴨連帽衛衣", category: "Hoodies", price: 429, photoColor: "Ink Black", aliases: "hoodie hooded pullover hooded sweatshirt 連帽衫 连帽衫 連帽衛衣 连帽卫衣", description: "Relaxed pullover hoodie with a kangaroo pocket and small embroidered duck. Demo specification: cotton-rich brushed fleece.", sizeGuide: "S: chest 108 cm / length 65 cm; M: 116 / 69 cm; L: 124 / 73 cm. Garment measurements, relaxed unisex fit." },
  { code: "DF06", slug: "rib-knit-beanie", name: "Duck Label Rib-Knit Beanie", nameZh: "小鴨標籤針織冷帽", category: "Beanies", price: 129, photoColor: "Chalk Cream", aliases: "beanie knit knitted rib winter hat woolly hat 冷帽 毛帽 針織帽 针织帽", description: "Cuffed rib-knit beanie with a burgundy duck-logo label. Demo specification: soft acrylic knit.", sizeGuide: "S: head circumference 50–54 cm; M: 54–58 cm; L: 58–62 cm. Stretch-knit fit." },
  { code: "DF07", slug: "weekend-overshirt", name: "Weekend Duck Twill Overshirt", nameZh: "週末小鴨斜紋襯衫外套", category: "Overshirts", price: 459, photoColor: "Chalk Cream", aliases: "overshirt shirt jacket shacket button collar long sleeve 襯衫 衬衫 外套 夾克 夹克", description: "Relaxed button-front overshirt with a pointed collar, a chest pocket with a small duck emblem. Demo specification: cotton twill.", sizeGuide: "S: chest 108 cm / length 69 cm; M: 116 / 73 cm; L: 124 / 77 cm. Garment measurements, relaxed unisex fit." },
  { code: "DF08", slug: "weekend-shorts", name: "Weekend Duck Jersey Shorts", nameZh: "週末小鴨休閒短褲", category: "Shorts", price: 249, photoColor: "Ink Black", aliases: "shorts jersey casual lounge drawstring 短褲 短裤 休閒褲 休闲裤", description: "Easy jersey shorts with a drawstring waist, side pockets and a small embroidered duck near the hem. Demo specification: cotton jersey.", sizeGuide: "S: waist 70–78 cm / inseam 18 cm; M: 78–86 / 19 cm; L: 86–94 / 20 cm. Suggested body waist, relaxed unisex fit." },
];
export const capsuleShops = [
  { id: "PCL", name: "Central Store · SE_TEST" },
  { id: "PCB", name: "Causeway Bay Store · SE_TEST" },
  { id: "SH015", name: "Jumbo Sogo · SE_TEST" },
];
export function capsuleWords(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/t[ -]?shirts?|tees?\b/g, "tshirt").replace(/rib[ -]knit/g, "rib knit").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function capsuleTokens(query: string) {
  if (typeof query !== "string" || !query.trim() || query.length > 200) throw new Error("INVALID_QUERY");
  let words = query.replace(/\bsmall\b/gi, "S").replace(/\bmedium\b/gi, "M").replace(/\blarge\b/gi, "L");
  // Split common Cantonese/Mandarin searches before applying exact ASCII tokens.
  for (const [pattern, replacement] of [[/酒紅色|酒红色/g, " burgundy "], [/米白色|奶油色|白色/g, " cream "], [/黑色/g, " black "], [/連帽衛衣|连帽卫衣|連帽衫|连帽衫/g, " hoodie "], [/衛衣|卫衣/g, " sweatshirt "], [/T恤|t恤/g, " tshirt "], [/工裝褲|工装裤|長褲|长裤/g, " cargo "], [/短褲|短裤/g, " shorts "], [/冷帽|針織帽|针织帽/g, " beanie "], [/棒球帽|鴨舌帽|鸭舌帽/g, " cap "], [/襯衫|衬衫/g, " overshirt "], [/有冇|有沒有|有没有|請問|请问|我想要|我想買|我想买|我要|有貨|有货|一件|一頂|一顶/g, " "]] as const) words = words.replace(pattern, replacement);
  const stop = new Set("a an the do does you your have any i want would like looking for please me my show find need in at on of is are to and with size colour color stock available buy reserve pickup collection can could some all items products catalogue catalog central causeway bay jumbo sogo hk hong kong fashion".split(" "));
  return [...new Set(capsuleWords(words).split(/\s+/).filter(t => t && !stop.has(t)))];
}
