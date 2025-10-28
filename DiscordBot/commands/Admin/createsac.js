const functions = require("../../../structs/functions.js");

module.exports = {
    commandInfo: {
        name: "createsac",
        description: "Creates a Support A Creator Code.",
        options: [
            {
                name: "code",
                description: "The Support A Creator Code.",
                required: true,
                type: 3
            },            
            {
                name: "ingame-username",
                description: "In-Game Name of the codes owner.",
                required: true,
                type: 3
            },
        ],
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member?.permissions.has("ADMINISTRATOR")) {
            return interaction.editReply({ content: "You do not have administrator permissions.", ephemeral: true });
        }

        const { options } = interaction;

        const code = options.get("code").value;
        const username = options.get("ingame-username").value;
        const creator = interaction.user.id;

        const resp = await functions.createSAC(code, username, creator);

        if (!resp.message) return interaction.editReply({ content: "There was an unknown error!", ephemeral: true });
        if (resp.status >= 400) return interaction.editReply({ content: resp.message, ephemeral: true });

        interaction.editReply({ content: resp.message, ephemeral: true });
    }
};
