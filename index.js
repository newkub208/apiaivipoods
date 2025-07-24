// server.js (Adapted for Vercel Root)

// Import required modules
const express = require('express');
const path = require('path'); // Added back for original file path logic
const fs = require('fs').promises;

// Initialize the express app
const app = express();

// IMPORTANT: Vercel has an ephemeral filesystem. Data written here will be lost.
const AI_DATA_PATH = path.join(__dirname, 'ai_data.json'); 
const ADMIN_PASSWORD = "975699zz";

// --- Middleware ---
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// We don't need express.static as Vercel handles static files via vercel.json

// --- Helper Functions ---
const readAiData = async () => {
    try {
        await fs.access(AI_DATA_PATH);
        const data = await fs.readFile(AI_DATA_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // On Vercel, this will likely happen on every new instance start
        console.log("ai_data.json not found, creating a new one.");
        await writeAiData({ bots: [] });
        return { bots: [] };
    }
};

const writeAiData = async (data) => {
    try {
        await fs.writeFile(AI_DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error("Could not write to ai_data.json.", error);
    }
};

const resolvePath = (object, path) => {
    try {
        return path.split('.').reduce((o, p) => (o && o[p] != null) ? o[p] : undefined, object);
    } catch (e) {
        return undefined;
    }
};

const updateMessageCount = async (botId) => {
    try {
        const aiData = await readAiData();
        const botIndex = aiData.bots.findIndex(b => b.id === botId);
        if (botIndex !== -1) {
            aiData.bots[botIndex].messageCount = (aiData.bots[botIndex].messageCount || 0) + 1;
            await writeAiData(aiData);
            console.log(`Updated message count for bot ${botId}`);
        }
    } catch (error) {
        console.error('Failed to update message count:', error);
    }
};


// --- API Routes ---
// The rest of your API routes (/api/bots, /api/chat, etc.) go here
// and remain unchanged from the previous version.

app.get('/api/bots', async (req, res) => {
    const data = await readAiData();
    res.status(200).json(data.bots);
});
app.get('/api/bots/:id', async (req, res) => {
    const { id } = req.params;
    const data = await readAiData();
    const bot = data.bots.find(b => b.id === id);
    if (bot) {
        res.status(200).json(bot);
    } else {
        res.status(404).json({ error: 'Bot not found' });
    }
});
app.post('/api/bots', async (req, res) => {
    const newBot = req.body;
    if (!newBot || !newBot.id || !newBot.name || !newBot.model || !newBot.capability) {
        return res.status(400).json({ error: 'ข้อมูลบอทไม่สมบูรณ์ ทุกช่องเป็นสิ่งจำเป็น' });
    }
    if (newBot.name.length > 16) {
        return res.status(400).json({ error: 'ชื่อ AI ต้องมีความยาวไม่เกิน 16 ตัวอักษร' });
    }
    if (newBot.model === 'custom' && (!newBot.apiUrl || !newBot.jsonResponsePath || !newBot.apiUrl.includes('[PROMPT]'))) {
        return res.status(400).json({ error: 'Custom API ต้องมี URL ที่ถูกต้องและมี [PROMPT] placeholder' });
    }
    newBot.messageCount = 0;
    const data = await readAiData();
    data.bots.push(newBot);
    await writeAiData(data);
    res.status(201).json(newBot);
});
app.delete('/api/bots/:id', async (req, res) => {
    const { id } = req.params;
    const { adminPassword } = req.body;
    if (adminPassword !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'รหัสผ่านแอดมินไม่ถูกต้อง' });
    }
    const data = await readAiData();
    const initialLength = data.bots.length;
    data.bots = data.bots.filter(b => b.id !== id);
    if (data.bots.length < initialLength) {
        await writeAiData(data);
        res.status(200).json({ message: 'Bot deleted successfully' });
    } else {
        res.status(404).json({ error: 'Bot not found' });
    }
});

app.post('/api/chat', async (req, res) => {
    const fetch = (await import('node-fetch')).default;
    const { prompt, botId, imageUrl } = req.body;

    if (!prompt && !imageUrl) {
        return res.status(400).json({ content: 'Prompt or image is required.' });
    }
     if (!botId) {
        return res.status(400).json({ content: 'Parameter "botId" is required.' });
    }

    try {
        const aiData = await readAiData();
        const bot = aiData.bots.find(b => b.id === botId);

        if (!bot) {
            throw new Error('Bot configuration not found.');
        }

        if (imageUrl && bot.capability !== 'vision') {
            throw new Error('This AI cannot process images.');
        }
        
        const fetchOptions = {
            headers: { 'Referer': 'https://kaiz-apis.gleeze.com/' }
        };

        let fullResponse;

        if (bot.model === 'custom') {
            if (imageUrl) throw new Error('Custom APIs do not support image input in this version.');
            if (!bot.apiUrl || !bot.jsonResponsePath || !bot.apiUrl.includes('[PROMPT]')) throw new Error('Custom AI is not configured correctly.');
            
            const targetUrl = bot.apiUrl.replace(/\[PROMPT\]/g, encodeURIComponent(prompt));
            console.log(`Routing to Custom API URL: "${targetUrl}"`);
            const apiResponse = await fetch(targetUrl, fetchOptions);
            if (!apiResponse.ok) throw new Error(`Custom API responded with status ${apiResponse.status}: ${await apiResponse.text()}`);
            
            const contentType = apiResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const errorText = await apiResponse.text();
                throw new Error(`API ภายนอกไม่ได้ส่งข้อมูลกลับมาเป็น JSON (อาจจะล่มชั่วขณะ). Response: ${errorText.substring(0, 200)}...`);
            }
            
            const data = await apiResponse.json();
            const responseText = resolvePath(data, bot.jsonResponsePath);
            if (responseText === undefined || responseText === null) throw new Error(`Could not find response in custom API result using path: "${bot.jsonResponsePath}"`);
            
            fullResponse = String(responseText);

        } else {
            // Pre-built API logic
            const uid = '1';
            const apiKey = 'e62d60dd-8853-4233-bbcb-9466b4cbc265';
            const baseUrl = 'https://kaiz-apis.gleeze.com/api/';
            
            const systemPrompt = bot.systemPrompt || '';
            const finalPrompt = `${systemPrompt}\n\n${prompt}`;
            const currentModel = bot.model;
            
            console.log(`Routing to Text Generation API for model: "${currentModel}"`);
            const promptParam = (currentModel.startsWith('gpt') || currentModel.startsWith('claude')) ? 'ask' : 'q';
            let targetUrl = `${baseUrl}${currentModel}?${promptParam}=${encodeURIComponent(finalPrompt)}&uid=${uid}&apikey=${apiKey}`;
            
            if (bot.capability === 'vision' && imageUrl) {
                targetUrl += `&imageUrl=${encodeURIComponent(imageUrl)}`;
                console.log('Image included in API call.');
            } else if (currentModel.includes('gemini')) {
                targetUrl += '&imageUrl=';
            }
            if (currentModel === 'gpt-4o') targetUrl += '&webSearch=off';

            const apiResponse = await fetch(targetUrl, fetchOptions);
            if (!apiResponse.ok) throw new Error(`External Text API responded with status ${apiResponse.status}: ${await apiResponse.text()}`);
            
             const contentType = apiResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const errorText = await apiResponse.text();
                throw new Error(`API ภายนอกไม่ได้ส่งข้อมูลกลับมาเป็น JSON (อาจจะล่มชั่วขณะ). Response: ${errorText.substring(0, 200)}...`);
            }
            
            const data = await apiResponse.json();
            const responseText = data.response || data.result || (data[0] ? data[0].response : undefined);
            if (!responseText) throw new Error('Invalid or unexpected response format from external AI API.');
            
            fullResponse = responseText;
        }

        // Update count and send response
        await updateMessageCount(botId);
        res.status(200).json({ content: fullResponse });

    } catch (error) {
        console.error(`Error in /api/chat (POST):`, error.message);
        res.status(500).json({ content: `ขออภัย, เกิดข้อผิดพลาด: ${error.message}` });
    }
});


// module.exports allows Vercel to handle the app
module.exports = app;
