CREATE TABLE products(style_code TEXT PRIMARY KEY,document TEXT NOT NULL CHECK(json_valid(document)));

CREATE TABLE variants(sku TEXT PRIMARY KEY,style_code TEXT NOT NULL REFERENCES products(style_code),color TEXT NOT NULL,size TEXT NOT NULL,search_text TEXT NOT NULL,document TEXT NOT NULL CHECK(json_valid(document)),UNIQUE(style_code,color,size));

CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT NOT NULL);

CREATE TABLE stock(sku TEXT NOT NULL REFERENCES variants(sku),location_id TEXT NOT NULL REFERENCES shops(id),quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 1000000),revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(sku,location_id));

CREATE TABLE stock_changes(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,document TEXT NOT NULL CHECK(json_valid(document)));