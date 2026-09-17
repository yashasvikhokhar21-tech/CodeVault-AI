const Listing = require('../models/listing');

// Chat responder: if OPENAI_API_KEY is set, send the message (plus any listing search results) to the LLM.
// Otherwise use the local rule-based logic. Always fallback to rule-based on errors.
module.exports.chat = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim().length === 0) {
      return res.json({ reply: "Please enter a question — I can help with listings, bookings, and account info." });
    }
    const text = message.toLowerCase();

    // If user asks to find listings in a location, try to extract the place and query DB
    let dbSummary = '';
    if (text.includes('find') && text.includes('in')) {
      const inIndex = text.lastIndexOf(' in ');
      if (inIndex !== -1) {
        const place = text.slice(inIndex + 4).trim();
        if (place.length > 0) {
          const regex = new RegExp(place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), 'i');
          const matches = await Listing.find({ location: regex }).limit(6);
          if (matches.length === 0) {
            dbSummary = `No listings found in ${place}.`;
          } else {
            const titles = matches.map(l => `${l.title} (${l.location})`).join('; ');
            dbSummary = `Found ${matches.length} listings in ${place}: ${titles}`;
          }
        }
      }
    }
    
      // Additional intent: price or details for a specific listing name
      // Patterns we look for: "price for <name>", "what's the price for <name>", "tell me about <name>", "details of <name>"
      let listingQuery = null;
      const priceMatch = message.match(/(?:price|cost|how much).*for\s+"?([^"?]+)"?/i);
      const priceMatch2 = message.match(/what(?:'| )?s the price for\s+"?([^"?]+)"?/i);
      const detailsMatch = message.match(/(?:tell me about|details of|show me|information about)\s+"?([^"?]+)"?/i);
      if (priceMatch) listingQuery = priceMatch[1].trim();
      else if (priceMatch2) listingQuery = priceMatch2[1].trim();
      else if (detailsMatch) listingQuery = detailsMatch[1].trim();
    
      let listingDetails = null;
      if (listingQuery) {
        // search by title (partial, case-insensitive)
        const qRegex = new RegExp(listingQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), 'i');
        const found = await Listing.find({ title: qRegex }).limit(6);
        if (found && found.length > 0) {
          // Build a structured summary of matches
          const summarized = found.map(l => {
            return {
              id: l._id.toString(),
              title: l.title,
              location: l.location || l.country || 'Unknown',
              price: typeof l.price === 'number' ? l.price : null,
              desc: l.description ? (l.description.length > 200 ? l.description.slice(0, 197) + '...' : l.description) : ''
            };
          });
          listingDetails = summarized;
        } else {
          listingDetails = [];
        }
      }

    // If OpenAI key is available, call the LLM to produce a helpful reply that may include DB summary
    if (process.env.OPENAI_API_KEY) {
      try {
        const { OpenAI } = require('openai');
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

          const systemPrompt = `You are a concise, factual assistant for a small listings website. Keep replies short (one or two short paragraphs). If the user asks about a specific listing and structured listing details are provided, answer using only those details and do not invent or assume any additional facts. If the provided data is incomplete, say you don't know and direct the user to the listing page (provide the relative path) for details. When listing multiple matches, limit to 6 and be concise.`;

        // Prepare an augmented user message that includes DB summaries and structured listing details when available.
        let userContent = '';
        if (listingDetails) {
          if (listingDetails.length === 0) {
            userContent += `No listings matched the name query "${listingQuery}".\n`;
          } else {
            userContent += 'Listing details (structured):\n';
            listingDetails.forEach(ld => {
              userContent += `- ${ld.title} | location: ${ld.location} | price: ${ld.price !== null ? ld.price : 'N/A'} | id: ${ld.id} | desc: ${ld.desc}\n`;
            });
            userContent += '\n';
          }
        }
        if (dbSummary) userContent += dbSummary + '\n\n';
        userContent += `User: ${message}`;

        // Attempt to create a chat completion. If the OpenAI SDK has a different method available
        // in the environment the try/catch below will fall back to rule-based.
        const response = await client.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          max_tokens: 300
        });

        const reply = response?.choices?.[0]?.message?.content?.trim();
        if (reply) return res.json({ reply });
      } catch (err) {
        // Log and continue to rule-based fallback
        console.error('OpenAI request failed, falling back to local responder:', err && err.message ? err.message : err);
      }
    }

    // If user asked about a specific listing and we have listingDetails, return an accurate factual reply
    if (listingDetails) {
      if (listingDetails.length === 0) {
        return res.json({ reply: `I couldn't find a listing matching "${listingQuery}".` });
      }
      // If only one match, provide a factual summary
      if (listingDetails.length === 1) {
        const ld = listingDetails[0];
        let out = `${ld.title} — location: ${ld.location}`;
        if (ld.price !== null) out += ` | price: ${ld.price}`;
        if (ld.desc) out += `\n${ld.desc}`;
        out += `\nVisit /listings/${ld.id} for details.`;
        return res.json({ reply: out });
      }
      // Multiple matches: list titles and ids
      const list = listingDetails.map(ld => `${ld.title} (/listings/${ld.id})`).join('; ');
      return res.json({ reply: `Multiple matches found: ${list}` });
    }

    // Local rule-based fallback
    // Booking help
    if (text.includes('book') || text.includes('booking')) {
      return res.json({ reply: "To book a listing: open the listing page and use the 'Book this listing' form (start date, end date, guests). Then the owner will accept or decline your request." });
    }

    // Price question
    if (text.includes('price') || text.includes('cost') || text.includes('how much')) {
      return res.json({ reply: "If you want a price for a specific listing, ask 'What's the price for [listing name]' or visit the listing page to see the per-night price." });
    }

    // Account help
    if (text.includes('signup') || text.includes('sign up') || text.includes('register') || text.includes('login') || text.includes('log in')) {
      return res.json({ reply: "You can sign up or log in using the links in the navbar. After logging in, you'll be able to request bookings and leave reviews." });
    }

    // If we had DB summary (no OpenAI reply) surface it
    if (dbSummary) {
      return res.json({ reply: dbSummary });
    }

    // General fallback
    return res.json({ reply: "I can help with searching listings (try 'Find listings in Goa'), booking instructions, and account help. Ask something like: 'Find listings in Mumbai' or 'How do I book?'." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ reply: "Sorry — something went wrong on the server." });
  }
};
