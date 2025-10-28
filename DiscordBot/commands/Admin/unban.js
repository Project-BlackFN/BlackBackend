const User = require("../../../model/user.js");

module.exports = {
    commandInfo: {
        name: "unban",
        description: "Unban a user from the backend by their username.",
        options: [
            {
                name: "username",
                description: "Target username.",
                required: true,
                type: 3
            }
        ]
    },
    execute: async (interaction) => {
        await interaction.deferReply({ ephemeral: true });
        
        if (!interaction.member?.permissions.has("ADMINISTRATOR")) {
            return interaction.editReply({ content: "You do not have administrator permissions.", ephemeral: true });
        }
    
        const targetUser = await User.findOne({ username_lower: (interaction.options.get("username").value).toLowerCase() });
    
        if (!targetUser) return interaction.editReply({ content: "The account username you entered does not exist.", ephemeral: true });
        else if (!targetUser.banned) return interaction.editReply({ content: "This account is already unbanned.", ephemeral: true });

        await targetUser.updateOne({ $set: { banned: false } });
        
        interaction.editReply({ content: `Successfully unbanned ${targetUser.username}`, ephemeral: true });
    }
};
