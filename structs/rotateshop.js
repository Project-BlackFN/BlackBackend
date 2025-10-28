const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const config = require('../Config/config.json');

const DAILY_ITEMS_COUNT = 6;
const FEATURED_ITEMS_COUNT = 2;

class Shop {
    constructor() {
        this.catalogConfigPath = path.join(__dirname, '../Config/catalog_config.json');
    }

    convertAbsoluteSeasonToChapterSeason(absoluteSeason) {
        if (absoluteSeason >= 1 && absoluteSeason <= 10) {
            return { chapter: 1, season: absoluteSeason };
        } else if (absoluteSeason >= 11 && absoluteSeason <= 18) {
            return { chapter: 2, season: absoluteSeason - 10 };
        } else if (absoluteSeason === 19) {
            return { chapter: 3, season: 1 };
        } else {
            return null;
        }
    }

    isItemValid(item) {
        const introduction = item.introduction || {};
        const rarity = item.rarity || {};

        const itemChapter = introduction.chapter ? parseInt(introduction.chapter, 10) : null;
        const itemSeason = introduction.season ? parseInt(introduction.season, 10) : null;
        const itemRarity = rarity.displayValue ? rarity.displayValue.toLowerCase() : null;

        if (!itemChapter || !itemSeason) return false;
        if (itemRarity === 'common') return false;

        const targetLimit = this.convertAbsoluteSeasonToChapterSeason(config.bSeason);
        if (targetLimit === null) return false;

        if (itemChapter < targetLimit.chapter) return true;
        if (itemChapter === targetLimit.chapter && itemSeason <= targetLimit.season) return true;

        return false;
    }

    async fetchItems() {
        try {
            const shopContentPath = path.join(__dirname, '../responses/shop_content.json');
            const fileContent = await fs.readFile(shopContentPath, 'utf-8');
            const jsonData = JSON.parse(fileContent);
            const cosmetics = jsonData.data || jsonData;
            return cosmetics.filter(item => this.isItemValid(item));
        } catch (error) {
            console.error('Failed to fetch cosmetics', error);
            return [];
        }
    }

    pickRandomItems(items, count) {
        const itemTypeBuckets = {
            outfit: [], emote: [], backpack: [], glider: [], pickaxe: [],
            loadingscreen: [], wrap: [], emoji: [], music: []
        };

        items.forEach(item => {
            const type = item.type?.value?.toLowerCase();
            if (itemTypeBuckets[type]) itemTypeBuckets[type].push(item);
        });

        const selectedItems = [];

        const addItemsFromBucket = (bucket, requiredCount) => {
            const shuffled = bucket.sort(() => 0.5 - Math.random());
            selectedItems.push(...shuffled.slice(0, Math.min(requiredCount, bucket.length)));
        };

        addItemsFromBucket(itemTypeBuckets.outfit, 2);
        addItemsFromBucket(itemTypeBuckets.emote, 1);
        addItemsFromBucket(itemTypeBuckets.backpack, 1);
        addItemsFromBucket(itemTypeBuckets.glider, 1);
        addItemsFromBucket(itemTypeBuckets.pickaxe, 1);
        addItemsFromBucket(itemTypeBuckets.wrap, 1);

        const remainingCount = count - selectedItems.length;
        if (remainingCount > 0) {
            const remainingItems = items.filter(item => !selectedItems.includes(item));
            const shuffled = remainingItems.sort(() => 0.5 - Math.random());
            selectedItems.push(...shuffled.slice(0, remainingCount));
        }

        return selectedItems.slice(0, count);
    }

    formatItemGrant(item) {
        const typeValue = item.type?.value.toLowerCase();
        let itemType;

        switch (typeValue) {
            case 'outfit': itemType = 'AthenaCharacter'; break;
            case 'emote': itemType = 'AthenaDance'; break;
            case 'backpack': itemType = 'AthenaBackpack'; break;
            case 'glider': itemType = 'AthenaGlider'; break;
            case 'pickaxe': itemType = 'AthenaPickaxe'; break;
            case 'wrap': itemType = 'AthenaItemWrap'; break;
            case 'loadingscreen': itemType = 'AthenaLoadingScreen'; break;
            case 'music': itemType = 'AthenaMusicPack'; break;
            case 'emoji': itemType = 'AthenaEmoji'; break;
            case 'spray': itemType = 'AthenaSpray'; break;
            default: itemType = item.type.backendValue || `Athena${this.capitalize(typeValue)}`;
        }

        return [`${itemType}:${item.id}`];
    }

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    calculatePrice(item) {
        const rarity = item.rarity?.displayValue?.toLowerCase();
        const type = item.type?.value?.toLowerCase();
        const series = item.series?.value?.toLowerCase();

        if (series) {
            const specialSeries = ['gaming legends series', 'marvel series', 'star wars series', 
                                   'dc series', 'icon series'];
            const premiumSeries = ['shadow series', 'frozen series', 'slurp series', 'dark series'];
            
            if (specialSeries.includes(series)) {
                switch (type) {
                    case 'outfit': return 1500;
                    case 'pickaxe': return 1200;
                    case 'backpack': return 1200;
                    case 'emote': return 500;
                    case 'glider': return 1200;
                    case 'wrap': return 700;
                    case 'loadingscreen': return 500;
                    case 'music': return 200;
                    case 'emoji': return 200;
                    default: return 999999;
                }
            }
            
            if (series === 'lava series') {
                switch (type) {
                    case 'outfit':
                    case 'glider':
                    case 'backpack': return 2000;
                    case 'pickaxe': return 1200;
                    default: return 200;
                }
            }
            
            if (premiumSeries.includes(series)) {
                switch (type) {
                    case 'outfit': return 1500;
                    case 'pickaxe': return 1200;
                    case 'backpack': return 1200;
                    case 'glider': return 1200;
                    case 'wrap': return 700;
                    default: return 200;
                }
            }
        }

        switch (type) {
            case 'outfit':
                switch (rarity) {
                    case 'legendary': return 2000;
                    case 'epic': return 1500;
                    case 'rare': return 1200;
                    case 'uncommon': return 800;
                    default: return 999999;
                }
            case 'pickaxe':
                switch (rarity) {
                    case 'epic': return 1200;
                    case 'rare': return 800;
                    case 'uncommon': return 500;
                    default: return 999999;
                }
            case 'backpack':
                switch (rarity) {
                    case 'legendary': return 2000;
                    case 'epic': return 1500;
                    case 'rare': return 1200;
                    case 'uncommon': return 200;
                    default: return 999999;
                }
            case 'emote':
            case 'emoji':
            case 'spray':
                switch (rarity) {
                    case 'legendary': return 2000;
                    case 'epic': return 800;
                    case 'rare': return 500;
                    case 'uncommon': return 200;
                    default: return 999999;
                }
            case 'glider':
                switch (rarity) {
                    case 'legendary': return 2000;
                    case 'epic': return 1200;
                    case 'rare': return 800;
                    case 'uncommon': return 500;
                    default: return 999999;
                }
            case 'wrap':
                switch (rarity) {
                    case 'legendary': return 1200;
                    case 'epic': return 700;
                    case 'rare': return 500;
                    case 'uncommon': return 300;
                    default: return 999999;
                }
            case 'loadingscreen':
                return rarity === 'uncommon' ? 200 : 500;
            case 'music':
                return ['legendary', 'epic'].includes(rarity) ? 500 : 200;
            default:
                return 999999;
        }
    }

    async updateCatalogConfig(dailyItems, featuredItems) {
        const catalogConfig = { '//': 'BR Item Shop Config' };

        dailyItems.forEach((item, index) => {
            catalogConfig[`daily${index + 1}`] = {
                itemGrants: this.formatItemGrant(item),
                price: this.calculatePrice(item)
            };
        });

        featuredItems.forEach((item, index) => {
            catalogConfig[`featured${index + 1}`] = {
                itemGrants: this.formatItemGrant(item),
                price: this.calculatePrice(item)
            };
        });

        await fs.writeFile(this.catalogConfigPath, JSON.stringify(catalogConfig, null, 4), 'utf-8');
        console.log('Shop rotated successfully');
    }

    async rotateShop() {
        try {
            const cosmetics = await this.fetchItems();
            if (!cosmetics.length) return console.error('No valid cosmetics found');

            const dailyItems = this.pickRandomItems(cosmetics, DAILY_ITEMS_COUNT);
            const featuredItems = this.pickRandomItems(cosmetics, FEATURED_ITEMS_COUNT);

            await this.updateCatalogConfig(dailyItems, featuredItems);
        } catch (error) {
            console.error('Shop rotation failed:', error);
        }
    }
}

module.exports = new Shop();
