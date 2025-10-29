const Shop = require("../../../structs/rotateshop.js");

module.exports = {
    commandInfo: {
        name: "rotateshop",
        description: "Rotate the item shop and update the catalog configuration.",
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member?.permissions.has("ADMINISTRATOR")) {
            return interaction.editReply({ content: "You do not have administrator permissions.", ephemeral: true });
        }

        try {
            await Shop.rotateShop();
            return interaction.editReply({ content: "Shop rotated successfully.", ephemeral: true });
        } catch (error) {
            console.error("Error rotating shop:", error);
            return interaction.editReply({ content: "Failed to rotate the shop.", ephemeral: true });
        }
    }
};
