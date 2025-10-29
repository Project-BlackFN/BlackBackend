const Users = require('../../../model/user');
const Profiles = require('../../../model/profiles');
const uuid = require("uuid");
const { MessageEmbed } = require("discord.js");

module.exports = {
    commandInfo: {
        name: "addvbucks",
        description: "Lets you change a user's amount of V-Bucks",
        options: [
            { name: "user", description: "The user you want to change the V-Bucks of", required: true, type: 6 },
            { name: "vbucks", description: "The amount of V-Bucks you want to give (Can be negative to deduct V-Bucks)", required: true, type: 4 }
        ]
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member?.permissions.has("ADMINISTRATOR")) {
            return interaction.editReply({ content: "You do not have administrator permissions.", ephemeral: true });
        }

        const selectedUser = interaction.options.getUser('user');
        const user = await Users.findOne({ discordId: selectedUser?.id });
        if (!user) return interaction.editReply({ content: "That user does not own an account", ephemeral: true });

        const vbucks = parseInt(interaction.options.getInteger('vbucks'));
        if (isNaN(vbucks) || vbucks === 0) return interaction.editReply({ content: "Invalid V-Bucks amount specified.", ephemeral: true });

        const filter = { accountId: user.accountId };

        const commonCoreKey = 'profiles.common_core.items.Currency:MtxPurchased.quantity';
        const profile0Key = 'profiles.profile0.items.Currency:MtxPurchased.quantity';

        const updatedProfile = await Profiles.findOneAndUpdate(
            filter,
            { $inc: { [commonCoreKey]: vbucks, [profile0Key]: vbucks } },
            { new: true }
        );

        if (!updatedProfile) return interaction.editReply({ content: "That user does not own an account", ephemeral: true });

        const common_core = updatedProfile.profiles.common_core;

        if (common_core.items['Currency:MtxPurchased'].quantity < 0 || common_core.items['Currency:MtxPurchased'].quantity >= 1000000) {
            return interaction.editReply({ content: "V-Bucks amount is out of valid range after the update.", ephemeral: true });
        }

        const purchaseId = uuid.v4();
        const lootList = [{ itemType: "Currency:MtxGiveaway", itemGuid: "Currency:MtxGiveaway", quantity: vbucks }];
        common_core.items[purchaseId] = {
            templateId: `GiftBox:GB_MakeGood`,
            attributes: {
                fromAccountId: `[Administrator]`,
                lootList,
                params: { userMessage: `Thanks for playing BlackFN!` },
                giftedOn: new Date().toISOString()
            },
            quantity: 1
        };

        common_core.rvn += 1;
        common_core.commandRevision += 1;
        common_core.updated = new Date().toISOString();

        await Profiles.updateOne(filter, { $set: { 'profiles.common_core': common_core } });

        const embed = new MessageEmbed()
            .setTitle("V-Bucks Updated")
            .setDescription(`Successfully added **${vbucks}** V-Bucks to <@${selectedUser.id}> with a GiftBox`)
            .setThumbnail("https://assets-launcher.blackfn.ghost143.de/blackfn.png")
            .setColor("GREEN")
            .setFooter({ text: "BlackFN", iconURL: "https://assets-launcher.blackfn.ghost143.de/blackfn.png" })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed], ephemeral: true });

        return {
            profileRevision: common_core.rvn,
            profileCommandRevision: common_core.commandRevision,
            newQuantityCommonCore: common_core.items['Currency:MtxPurchased'].quantity,
            newQuantityProfile0: updatedProfile.profiles.profile0.items['Currency:MtxPurchased'].quantity
        };
    }
};
