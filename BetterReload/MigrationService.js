const config = require('../Config/config.json');
const log = require("../structs/log.js");
const Profile = require("../model/profiles.js");

async function migrateData(profiles, fromSeason, toSeason) {
    const athena = profiles.profiles.athena;
    
    if (!athena.stats.attributes.season_history) {
        athena.stats.attributes.season_history = {};
    }
    
    const oldSeasonKey = `season_${fromSeason}`;
    
    const questItems = {};
    if (athena.items) {
        for (const [itemId, itemData] of Object.entries(athena.items)) {
            if (itemData.templateId && itemData.templateId.includes('Quest:quest')) {
                questItems[itemId] = JSON.parse(JSON.stringify(itemData));
            }
        }
    }
    
    athena.stats.attributes.season_history[oldSeasonKey] = {
        book_level: athena.stats.attributes.book_level || 1,
        book_purchased: athena.stats.attributes.book_purchased || false,
        season_match_boost: athena.stats.attributes.season_match_boost || 0,
        season_friend_match_boost: athena.stats.attributes.season_friend_match_boost || 0,
        level: athena.stats.attributes.level || 1,
        xp: athena.stats.attributes.xp || 0,
        quest_items: questItems,
        migrated_at: new Date().toISOString()
    };
    
    const newSeasonKey = `season_${toSeason}`;
    if (athena.stats.attributes.season_history[newSeasonKey]) {
        const savedData = athena.stats.attributes.season_history[newSeasonKey];
        athena.stats.attributes.book_level = savedData.book_level;
        athena.stats.attributes.book_purchased = savedData.book_purchased;
        athena.stats.attributes.season_match_boost = savedData.season_match_boost;
        athena.stats.attributes.season_friend_match_boost = savedData.season_friend_match_boost;
        athena.stats.attributes.level = savedData.level;
        athena.stats.attributes.xp = savedData.xp;
        
        if (athena.items && savedData.quest_items) {
            for (const [itemId, itemData] of Object.entries(athena.items)) {
                if (itemData.templateId && itemData.templateId.includes('Quest:quest')) {
                    delete athena.items[itemId];
                }
            }
            
            for (const [itemId, itemData] of Object.entries(savedData.quest_items)) {
                athena.items[itemId] = itemData;
            }
        }
    } else {
        athena.stats.attributes.book_level = 1;
        athena.stats.attributes.book_purchased = false;
        athena.stats.attributes.season_match_boost = 0;
        athena.stats.attributes.season_friend_match_boost = 0;
        athena.stats.attributes.level = 1;
        athena.stats.attributes.xp = 0;
        
        if (athena.items) {
            for (const [itemId, itemData] of Object.entries(athena.items)) {
                if (itemData.templateId && itemData.templateId.includes('Quest:quest')) {
                    delete athena.items[itemId];
                }
            }
        }
    }
    
    athena.stats.attributes.season_num = toSeason;
    athena.stats.attributes.last_season_migration = new Date().toISOString();
}

async function migrateUsers() {
    try {
        const CURRENT_SEASON = config.bSeason;
        const allProfiles = await Profile.find({});
        
        let migratedCount = 0;
        
        for (const userProfile of allProfiles) {
            const athena = userProfile.profiles?.athena;
            
            if (!athena) {
                continue;
            }
            
            const storedSeason = athena.stats.attributes.season_num || CURRENT_SEASON;
            if (storedSeason !== CURRENT_SEASON) {
                await migrateData(userProfile, storedSeason, CURRENT_SEASON);
                
                await Profile.updateOne(
                    { accountId: userProfile.accountId },
                    { $set: { "profiles.athena": athena } }
                );
                
                migratedCount++;
            }
        }
        
        log.backend`Migrating users complete (${migratedCount} users)`;
        
    } catch (err) {
        log.error`Migrating users failed (${err})`;
    }
}

module.exports = {
    migrateData,
    migrateUsers
};