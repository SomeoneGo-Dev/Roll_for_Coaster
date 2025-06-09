import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";

export const generateCoasterConcept = mutation({
  args: {
    typeRoll: v.number(),
    thrillRoll: v.number(),
    manufacturerRoll: v.number(),
    layoutRoll: v.number(),
    elementsRoll: v.number(),
    themeRoll: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Must be logged in to generate concepts");
    }

    // Get all coaster data
    const allData = await ctx.db.query("coasterData").collect();
    const dataMap: Record<string, string[]> = {};
    
    for (const data of allData) {
      dataMap[data.category] = data.items;
    }

    // Generate concept based on rolls
    const coasterType = dataMap.types?.[args.typeRoll % dataMap.types.length] || "Hypercoaster";
    const thrillLevel = dataMap.thrillLevels?.[args.thrillRoll % dataMap.thrillLevels.length] || "High Thrill";
    const manufacturer = dataMap.manufacturers?.[args.manufacturerRoll % dataMap.manufacturers.length] || "Bolliger & Mabillard";
    const layout = dataMap.layouts?.[args.layoutRoll % dataMap.layouts.length] || "Out and Back";
    const theme = dataMap.themes?.[args.themeRoll % dataMap.themes.length] || "Medieval Castle";
    
    // Select 2-4 random elements
    const numElements = 2 + (args.elementsRoll % 3);
    const specialElements: string[] = [];
    const elements = dataMap.elements || [];
    
    for (let i = 0; i < numElements; i++) {
      const elementIndex = (args.elementsRoll + i * 7) % elements.length;
      const element = elements[elementIndex];
      if (!specialElements.includes(element)) {
        specialElements.push(element);
      }
    }

    // Generate a basic name
    const name = `${theme.split(' ')[0]} ${coasterType}`;

    const conceptId = await ctx.db.insert("coasterConcepts", {
      userId,
      name,
      coasterType,
      thrillLevel,
      manufacturer,
      layout,
      specialElements,
      theme,
      rollData: {
        typeRoll: args.typeRoll,
        thrillRoll: args.thrillRoll,
        manufacturerRoll: args.manufacturerRoll,
        layoutRoll: args.layoutRoll,
        elementsRoll: args.elementsRoll,
        themeRoll: args.themeRoll,
      },
      isPublic: false,
    });

    return conceptId;
  },
});

export const expandConceptWithAI = action({
  args: {
    conceptId: v.id("coasterConcepts"),
    expandType: v.union(v.literal("description"), v.literal("theming"), v.literal("layout")),
  },
  handler: async (ctx, args) => {
    const concept = await ctx.runQuery(api.coasterConcepts.getCoasterConcept, { conceptId: args.conceptId });
    if (!concept) {
      throw new Error("Concept not found");
    }

    let prompt = "";
    let field = "";

    switch (args.expandType) {
      case "description":
        prompt = `Create an exciting description for a roller coaster with these specs:
Type: ${concept.coasterType}
Thrill Level: ${concept.thrillLevel}
Manufacturer: ${concept.manufacturer}
Layout: ${concept.layout}
Theme: ${concept.theme}
Special Elements: ${concept.specialElements.join(", ")}

Write a compelling 2-3 sentence description that captures the excitement and unique features of this coaster.`;
        field = "aiDescription";
        break;

      case "theming":
        prompt = `Design detailed theming for a ${concept.theme} themed roller coaster called "${concept.name}":
Type: ${concept.coasterType}
Layout: ${concept.layout}
Elements: ${concept.specialElements.join(", ")}

Describe the visual theming, story elements, queue experience, and special effects that would bring this theme to life. Be creative and immersive!`;
        field = "aiTheming";
        break;

      case "layout":
        prompt = `Create a detailed layout description for this roller coaster:
Name: ${concept.name}
Type: ${concept.coasterType}
Manufacturer: ${concept.manufacturer}
Layout Style: ${concept.layout}
Thrill Level: ${concept.thrillLevel}
Key Elements: ${concept.specialElements.join(", ")}

Describe the ride experience from start to finish, including lift hill, key elements, pacing, and finale. Make it exciting and technically feasible!`;
        field = "aiLayoutIdeas";
        break;
    }

    try {
      const response = await fetch(`${process.env.CONVEX_OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.CONVEX_OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-nano",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
        }),
      });

      const data = await response.json();
      const aiContent = data.choices?.[0]?.message?.content;

      if (aiContent) {
        await ctx.runMutation(api.coasterConcepts.updateConceptAI, {
          conceptId: args.conceptId,
          field,
          content: aiContent,
        });
      }

      return aiContent;
    } catch (error) {
      console.error("AI expansion failed:", error);
      throw new Error("Failed to generate AI content");
    }
  },
});

export const updateConceptAI = mutation({
  args: {
    conceptId: v.id("coasterConcepts"),
    field: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Must be logged in");
    }

    const concept = await ctx.db.get(args.conceptId);
    if (!concept || concept.userId !== userId) {
      throw new Error("Concept not found or unauthorized");
    }

    const updates: any = {};
    updates[args.field] = args.content;

    await ctx.db.patch(args.conceptId, updates);
  },
});

export const getCoasterConcept = query({
  args: { conceptId: v.id("coasterConcepts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conceptId);
  },
});

export const getUserConcepts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    return await ctx.db
      .query("coasterConcepts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});

export const getPublicConcepts = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("coasterConcepts")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .order("desc")
      .take(10);
  },
});

export const toggleConceptPublic = mutation({
  args: { conceptId: v.id("coasterConcepts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Must be logged in");
    }

    const concept = await ctx.db.get(args.conceptId);
    if (!concept || concept.userId !== userId) {
      throw new Error("Concept not found or unauthorized");
    }

    await ctx.db.patch(args.conceptId, {
      isPublic: !concept.isPublic,
    });
  },
});

export const updateConceptName = mutation({
  args: {
    conceptId: v.id("coasterConcepts"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Must be logged in");
    }

    const concept = await ctx.db.get(args.conceptId);
    if (!concept || concept.userId !== userId) {
      throw new Error("Concept not found or unauthorized");
    }

    await ctx.db.patch(args.conceptId, {
      name: args.name,
    });
  },
});

export const deleteConcept = mutation({
  args: { conceptId: v.id("coasterConcepts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Must be logged in");
    }

    const concept = await ctx.db.get(args.conceptId);
    if (!concept || concept.userId !== userId) {
      throw new Error("Concept not found or unauthorized");
    }

    await ctx.db.delete(args.conceptId);
  },
});
