const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws'); // Import WebSocket as well
const http = require('http'); // Import the http module
const dotenv = require('dotenv');

dotenv.config();

const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const registeredServers = {};
const webSocketClients = {};

// ============ AJOUT POUR LE DESSIN ============
// Stockage des dessins par channel
const drawings = {};

// Configuration du canvas (taille par défaut)
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 550;

// Fonction pour créer un canvas vide
function getEmptyCanvas() {
    return {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        lines: []  // Stocke tous les traits
    };
}
// ============ FIN AJOUT POUR LE DESSIN ============

bot.once('ready', () => {
    console.log(`Bot connecté en tant que ${bot.user.tag}`);
});

bot.on('messageCreate', (message) => {
    if (message.author.bot) return;

    const guildId = message.guild.id;

    if (!registeredServers[guildId]) {
        registeredServers[guildId] = {};
    }

    const serverData = registeredServers[guildId];

    if (message.content.startsWith('!register')) {
        const channelId = message.channel.id;
        serverData[channelId] = { messages: [] };
        message.channel.send(
            `Channel **${message.channel.name}** enregistré pour le serveur **${message.guild.name}**.`
        );
    }

    if (message.content.startsWith('!tell')) {
        const channelId = message.channel.id;

        if (serverData[channelId]) {
            const newMessage = {
                username: message.author.username,
                avatar: message.author.displayAvatarURL(),
                content: message.content.split(' ').slice(1).join(' '),
                attachments: message.attachments.map((attachment) => ({
                    url: attachment.url,
                    type: attachment.contentType,
                })),
            };

            serverData[channelId].messages.push(newMessage);

            if (webSocketClients[channelId]) {
                webSocketClients[channelId].forEach((ws) => {
                    ws.send(JSON.stringify(newMessage));
                });
            }

            // React to the message with a checkmark emoji
            message.react('✅');

        } else {
            message.channel.send(
                "Ce channel n'est pas enregistré. Utilisez `!register` pour commencer."
            );
        }
    }

    if (message.content.startsWith('!stell')) {
        const channelId = message.channel.id;

        if (serverData[channelId]) {
            const newMessage = {
                username: null, // Set username to null
                avatar: 'https://example.com/anonymous-avatar.png', // Placeholder avatar URL
                content: message.content.split(' ').slice(1).join(' '),
                attachments: message.attachments.map((attachment) => ({
                    url: attachment.url,
                    type: attachment.contentType,
                })),
            };

            serverData[channelId].messages.push(newMessage);

            if (webSocketClients[channelId]) {
                webSocketClients[channelId].forEach((ws) => {
                    ws.send(JSON.stringify(newMessage));
                });
            }

            message.channel.send(
                `Message anonyme ajouté pour le channel **${message.channel.name}**.`
            );
        } else {
            message.channel.send(
                "Ce channel n'est pas enregistré. Utilisez `!register` pour commencer."
            );
        }
    }

    if (message.content.startsWith('!help')) {
        const helpMessage = `
        **Commandes disponibles :**
        \`!register\` - Enregistrer le channel pour recevoir des messages.
        \`!tell <message>\` - Envoyer un message avec votre nom d'utilisateur.
        \`!stell <message>\` - Envoyer un message anonymement.
        \`!url\` - Obtenir l'URL pour afficher les messages.
        \`!help\` - Afficher ce message d'aide.
        `;
        message.channel.send(helpMessage);
    }

    if (message.content.startsWith('!url')) {
        const channelId = message.channel.id;
        const protocol = useSecureWs ? 'https' : 'http';
        const botLink = `${protocol}://${baseUrl}${(port === 80 || hideWebViewPort) ? '' : `:${port}`}`;
        const url = `${botLink}/view/${channelId}`;
        message.channel.send(`URL pour le channel **${message.channel.name}**: ${url}`);
    }
});

bot.login(process.env.BOT_TOKEN);

// Web server
const app = express();
app.set('view engine', 'ejs');

app.use(express.static('public'));

app.get('/view/:channelId', (req, res) => {
    const channelId = req.params.channelId;
    res.render('index', {
        channelId,
        useSecureWs: process.env.USE_SECURE_WS === 'true',
        baseUrl: process.env.BASE_URL || 'localhost',
        wsPort: process.env.PORT || '80', // Default to 80
        hideWebsocketPort: process.env.HIDE_WS_PORT === 'true',
    });
});

// ============ AJOUT : Route pour la page de dessin ============
app.get('/draw/:channelId', (req, res) => {
    const channelId = req.params.channelId;
    res.render('draw', {
        channelId,
        useSecureWs: process.env.USE_SECURE_WS === 'true',
        baseUrl: process.env.BASE_URL || 'localhost',
        wsPort: process.env.PORT || '80',
        hideWebsocketPort: process.env.HIDE_WS_PORT === 'true',
    });
});
// ============ FIN AJOUT ============

const baseUrl = process.env.BASE_URL || 'localhost';
const port = process.env.PORT || 80; // Default to 80
const useSecureWs = process.env.USE_SECURE_WS === 'true';
const hideWebViewPort = process.env.HIDE_WEBVIEW_PORT === 'true';

console.log(`Démarre le serveur web sur le port ${port} (adresse: ${baseUrl})`);

// Create an HTTP server
const server = http.createServer(app);

// Initialize WebSocket server using the HTTP server
const wss = new WebSocketServer({ noServer: true }); // Don't create a separate server

// ============ VERSION MODIFIÉE DU WebSocket (avec support dessin) ============
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const channelId = params.get('channelId');

    if (!webSocketClients[channelId]) {
        webSocketClients[channelId] = [];
    }

    webSocketClients[channelId].push(ws);

    console.log(`Client connecté au channel ID: ${channelId}`);

    // Initialiser le stockage du dessin pour ce channel
    if (!drawings[channelId]) {
        drawings[channelId] = getEmptyCanvas();
    }

    // Envoyer l'état actuel du dessin au nouveau client
    ws.send(JSON.stringify({
        type: 'init_drawing',
        canvas: drawings[channelId]
    }));

    // Écouter les messages de dessin
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Gestion des messages de dessin
            if (message.type === 'draw') {
                // Stocker le trait
                drawings[channelId].lines.push({
                    tool: message.tool,
                    x1: message.x1, y1: message.y1,
                    x2: message.x2, y2: message.y2,
                    color: message.color,
                    size: message.size
                });
                
                // Limiter le stockage (garde les 500 derniers traits)
                if (drawings[channelId].lines.length > 500) {
                    drawings[channelId].lines.shift();
                }
                
                // Diffuser à tous les autres clients du même channel
                if (webSocketClients[channelId]) {
                    webSocketClients[channelId].forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'draw',
                                tool: message.tool,
                                x1: message.x1, y1: message.y1,
                                x2: message.x2, y2: message.y2,
                                color: message.color,
                                size: message.size
                            }));
                        }
                    });
                }
            }
            
            // Gestion du clear (effacer tout)
            else if (message.type === 'clear') {
                drawings[channelId] = getEmptyCanvas();
                
                // Diffuser le clear à tous les clients
                if (webSocketClients[channelId]) {
                    webSocketClients[channelId].forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'clear' }));
                        }
                    });
                }
            }
            
        } catch (e) {
            console.error('Erreur de parsing WebSocket:', e);
        }
    });

    ws.on('close', () => {
        webSocketClients[channelId] = webSocketClients[channelId].filter(
            (client) => client !== ws
        );
        console.log(`Client déconnecté du channel ID: ${channelId}`);
    });
});
// ============ FIN MODIFICATION WebSocket ============

// Handle the HTTP server upgrade to WebSocket
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
    });
});

// Start the HTTP server
server.listen(port, () =>
    console.log(`Serveur web démarré sur le port ${port}`)
);

console.log(`Serveur WebSocket démarré sur le port ${port}`);
