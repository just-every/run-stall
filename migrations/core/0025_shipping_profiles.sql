-- Shipping profiles: the general profile every product starts in, custom profiles, the shop's
-- pickup and local-delivery places, and the product/variant assignments. The earlier single
-- flat charge becomes the general profile's one "Domestic shipping" service.
CREATE TABLE st_shipping_profiles (id TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL CHECK(json_valid(value_json)), revision TEXT NOT NULL);
CREATE TABLE st_shipping_places (id TEXT PRIMARY KEY NOT NULL CHECK(id IN ('pickup','delivery')), value_json TEXT NOT NULL CHECK(json_valid(value_json)), revision TEXT NOT NULL);
CREATE TABLE st_shipping_assignments (sku TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL);
INSERT INTO st_shipping_profiles(id,value_json,revision)
 SELECT 'general',json_object('name','General','zones',json('[]'),'services',json_array(json_object('code','standard','name','Domestic shipping','rate',json_object('type','flat','cents',shipping_cents))),'pickup',json('true'),'delivery',json('true')),lower(hex(randomblob(16))) FROM st_shipping WHERE id=1;
DROP TABLE st_shipping;
