require("dotenv").config();
const { Bot, InlineKeyboard } = require("grammy");
const fs = require("fs");
const express = require("express");

// Создаем Express приложение
const app = express();
const port = process.env.PORT || 3000;

const bot = new Bot(process.env.BOT_TOKEN);

// ---------- UTILS ----------
const read = (file, def) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : def);
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const safeAnswer = async (ctx) => { try { await ctx.answerCallbackQuery(); } catch {} };

const usersF = "users.json";
const collectionsF = "collections.json";
const pollsF = "polls.json";

const users = () => read(usersF, {});
const saveUsers = (data) => write(usersF, data);
const collections = () => read(collectionsF, []);
const saveCollections = (data) => write(collectionsF, data);
const polls = () => read(pollsF, []);
const savePolls = (data) => write(pollsF, data);

// Функция для безопасного редактирования сообщений
async function safeEditMessage(ctx, text, keyboard) {
    try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch (error) {
        if (error.description?.includes('message is not modified')) {
            console.log('Сообщение не изменилось, пропускаем');
            return;
        }
        throw error;
    }
}

// =====================================================
// ============== НАПОМИНАНИЯ О ДЕДЛАЙНАХ =============
// =====================================================

// Функция для парсинга даты из строки (дд.мм.гггг)
function parseDate(dateString) {
    if (!dateString) return null;
    const parts = dateString.split('.');
    if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const year = parseInt(parts[2]);
        return new Date(year, month, day);
    }
    return null;
}

// Функция для форматирования даты в читаемый вид
function formatDate(date) {
    if (!date) return "Не указано";
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

// Функция для проверки дедлайнов и отправки напоминаний
async function checkDeadlines() {
    console.log("⏰ Проверка дедлайнов...");
    
    const cols = collections();
    const u = users();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    for (const collection of cols) {
        const deadlineDate = parseDate(collection.deadline);
        if (!deadlineDate) continue;
        
        const deadlineDay = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
        const diffTime = deadlineDay - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 3 || diffDays === 1 || diffDays === 0) {
            const reminderKey = `reminder_${formatDate(today)}`;
            if (!collection[reminderKey]) {
                collection[reminderKey] = true;
                
                Object.keys(u).forEach(userId => {
                    if (u[userId] && u[userId].role === "participant" && !collection.paidUsers?.[userId]) {
                        let reminderText = '';
                        
                        if (diffDays === 3) {
                            reminderText = `⏰ **НАПОМИНАНИЕ**\n\nЧерез 3 дня заканчивается сбор:\n📌 ${collection.title}\n\nСумма: ${collection.amount}\nДедлайн: ${collection.deadline}`;
                        } else if (diffDays === 1) {
                            reminderText = `⚠️ **СРОЧНОЕ НАПОМИНАНИЕ**\n\nДо дедлайна остался 1 день!\n📌 ${collection.title}\n\nСумма: ${collection.amount}\nДедлайн: ${collection.deadline}`;
                        } else if (diffDays === 0) {
                            reminderText = `🔴 **СЕГОДНЯ ПОСЛЕДНИЙ ДЕНЬ**\n\nСбор средств закрывается сегодня!\n📌 ${collection.title}\n\nСумма: ${collection.amount}\nДедлайн: ${collection.deadline}`;
                        }
                        
                        if (reminderText) {
                            bot.api.sendMessage(userId, reminderText, { parse_mode: "Markdown" })
                                .catch(e => console.log(`Ошибка отправки напоминания пользователю ${userId}:`, e));
                        }
                    }
                });
                
                if (u[u.treasurerId]) {
                    const paidCount = Object.keys(collection.paidUsers || {}).length;
                    const totalParticipants = Object.keys(u).filter(id => u[id].role === "participant").length;
                    
                    let treasurerText = '';
                    if (diffDays === 3) {
                        treasurerText = `📊 **СТАТУС СБОРА**\n\nДо дедлайна 3 дня\n📌 ${collection.title}\n✅ Оплатили: ${paidCount} из ${totalParticipants}`;
                    } else if (diffDays === 1) {
                        treasurerText = `📊 **СТАТУС СБОРА**\n\nДо дедлайна 1 день!\n📌 ${collection.title}\n✅ Оплатили: ${paidCount} из ${totalParticipants}`;
                    } else if (diffDays === 0) {
                        treasurerText = `📊 **СЕГОДНЯ ДЕДЛАЙН**\n\nСбор закрывается сегодня!\n📌 ${collection.title}\n✅ Оплатили: ${paidCount} из ${totalParticipants}`;
                    }
                    
                    if (treasurerText) {
                        bot.api.sendMessage(u.treasurerId, treasurerText, { parse_mode: "Markdown" })
                            .catch(e => console.log("Ошибка отправки уведомления казначею:", e));
                    }
                }
            }
        }
        
        if (diffDays < 0 && !collection.deadlinePassedNotified) {
            collection.deadlinePassedNotified = true;
            
            const paidCount = Object.keys(collection.paidUsers || {}).length;
            const totalParticipants = Object.keys(u).filter(id => u[id].role === "participant").length;
            
            if (u[u.treasurerId]) {
                bot.api.sendMessage(u.treasurerId,
`📊 **ИТОГИ СБОРА**

Сбор "${collection.title}" завершен

✅ Оплатили: ${paidCount} участников
❌ Не оплатили: ${totalParticipants - paidCount} участников

Дедлайн: ${collection.deadline}`, { parse_mode: "Markdown" }).catch(e => console.log("Ошибка отправки итогов казначею:", e));
            }
        }
    }
    
    saveCollections(cols);
}

function startDeadlineChecker() {
    checkDeadlines();
    setInterval(checkDeadlines, 60 * 60 * 1000);
    console.log("⏰ Планировщик напоминаний запущен");
}

async function setupMenuButton() {
    try {
        await bot.api.setMyCommands([
            { command: "start", description: "🚀 Запустить бота" },
            { command: "menu", description: "🏠 Открыть главное меню" },
            { command: "help", description: "❓ Помощь и подсказки" },
            { command: "check_deadlines", description: "⏰ Проверить дедлайны" }
        ]);
        console.log("✅ Команды зарегистрированы");

        await bot.api.setChatMenuButton({
            menuButton: {
                type: 'commands'
            }
        });
        console.log("✅ Постоянная кнопка меню установлена");
    } catch (error) {
        console.error("❌ Ошибка при настройке меню:", error);
    }
}

async function treasurerMenu(ctx) {
    const kb = new InlineKeyboard()
        .text("➕ Создать сбор", "new_collection").text("📊 Создать опрос", "new_poll").row()
        .text("📂 Мои сборы", "my_collections").text("📝 Мои опросы", "my_polls");
    
    const text = "👑 Меню казначея\n\nВыберите действие:";
    
    if (ctx.callbackQuery) {
        await safeEditMessage(ctx, text, kb);
    } else {
        await ctx.reply(text, { reply_markup: kb });
    }
}

async function participantMenu(ctx) {
    const kb = new InlineKeyboard()
        .text("💰 Сборы", "list_collections").row()
        .text("📊 Опросы", "list_polls");
    
    const text = "💠 Меню участника\n\nВыберите действие:";
    
    if (ctx.callbackQuery) {
        await safeEditMessage(ctx, text, kb);
    } else {
        await ctx.reply(text, { reply_markup: kb });
    }
}

bot.command("start", async (ctx) => {
    const u = users();
    
    if (!u.treasurerId) {
        return ctx.reply("Кто будет казначеем?", {
            reply_markup: new InlineKeyboard().text("👑 Я казначей", "be_treasurer")
        });
    }
    
    if (!u[ctx.chat.id]) {
        u[ctx.chat.id] = { 
            role: "participant", 
            name: ctx.from.first_name, 
            step: null, 
            temp: {} 
        };
        saveUsers(u);
    }
    
    const user = u[ctx.chat.id];
    if (user.role === "treasurer") {
        await treasurerMenu(ctx);
        await ctx.reply("💡 Подсказка: используйте кнопку меню (≡) для быстрого доступа\n⏰ Напоминания о дедлайнах приходят автоматически");
    } else {
        await participantMenu(ctx);
    }
});

bot.command("menu", async (ctx) => {
    const u = users();
    const user = u[ctx.chat.id];
    
    if (!user) {
        return ctx.reply("Сначала используйте /start");
    }
    
    user.role === "treasurer" ? await treasurerMenu(ctx) : await participantMenu(ctx);
});

bot.command("help", (ctx) => {
    const helpText = `
📋 Доступные команды:
/start - Начать работу с ботом
/menu - Открыть главное меню
/help - Показать эту справку
/check_deadlines - Проверить дедлайны (только для казначея)

💡 Как пользоваться:
• Нажмите на кнопку меню (≡) рядом с полем ввода
• Выберите нужную команду из списка
• Следуйте инструкциям бота

⏰ Напоминания:
• Бот автоматически напоминает о дедлайнах за 3 дня, 1 день и в день сбора
• Казначей получает уведомления о статусе сбора
• После дедлайна приходит итоговый отчет

❓ Если что-то не работает:
• Убедитесь, что вы нажали /start
• Попробуйте написать /menu
• Обратитесь к казначею
    `;
    ctx.reply(helpText);
});

bot.command("check_deadlines", async (ctx) => {
    const u = users();
    const user = u[ctx.chat.id];
    
    if (!user || user.role !== "treasurer") {
        return ctx.reply("❌ Эта команда только для казначея");
    }
    
    await ctx.reply("⏰ Проверяю дедлайны...");
    await checkDeadlines();
    await ctx.reply("✅ Проверка завершена");
});

bot.callbackQuery("be_treasurer", async (ctx) => {
    await safeAnswer(ctx);
    const u = users();
    
    if (u.treasurerId) {
        return await participantMenu(ctx);
    }
    
    u[ctx.chat.id] = { 
        role: "pending_treasurer", 
        name: ctx.from.first_name, 
        step: "awaiting_password", 
        temp: {} 
    };
    saveUsers(u);
    
    await ctx.reply("🔐 Введите пароль для доступа к роли казначея:");
});

bot.callbackQuery("new_collection", async (ctx) => {
    await safeAnswer(ctx);
    const u = users();
    
    if (u[ctx.chat.id]?.role !== "treasurer") {
        return ctx.reply("❌ Только казначей может создавать сборы");
    }
    
    u[ctx.chat.id].step = "collection_title";
    u[ctx.chat.id].temp = {};
    saveUsers(u);
    
    await ctx.reply("На что собираем средства? (введите название сбора)");
});

bot.callbackQuery("new_poll", async (ctx) => { 
    await safeAnswer(ctx); 
    const u = users();
    
    if (u[ctx.chat.id]?.role !== "treasurer") {
        return ctx.reply("❌ Только казначей может создавать опросы");
    }
    
    u[ctx.chat.id].step = "poll_question"; 
    u[ctx.chat.id].temp = {};
    saveUsers(u); 
    
    await ctx.reply("Введите вопрос опроса:"); 
});

bot.on("message:text", async (ctx) => {
  const u = users();
  const userId = ctx.chat.id;
  const user = u[userId];
  
  if (!user) {
    return;
  }

  if (user.step === "awaiting_password") {
      const enteredPassword = ctx.message.text;
      
      if (enteredPassword === "1987") {
          u.treasurerId = userId;
          user.role = "treasurer";
          user.step = null;
          user.temp = {};
          saveUsers(u);
          
          await ctx.reply("✅ Пароль принят! Вы назначены казначеем.");
          await treasurerMenu(ctx);
          await ctx.reply("💡 Подсказка: используйте кнопку меню (≡) для быстрого доступа\n⏰ Напоминания о дедлайнах приходят автоматически");
      } else {
          delete u[userId];
          saveUsers(u);
          
          await ctx.reply("❌ Неверный пароль. Доступ запрещен.\n\nЕсли вы хотите стать казначеем, нажмите /start и попробуйте снова.");
      }
      return;
  }

  if (user.step && user.step.startsWith("collection_")) {
    if (!user.temp) user.temp = {};

    if (user.step === "collection_title") {
      user.temp.title = ctx.message.text;
      user.step = "collection_amount";
      saveUsers(u);
      await ctx.reply("Сумма (введите число):");
    } 
    else if (user.step === "collection_amount") {
      user.temp.amount = ctx.message.text;
      user.step = "collection_deadline";
      saveUsers(u);
      await ctx.reply("Сдать средства до (дд.мм.гггг):");
    } 
    else if (user.step === "collection_deadline") {
      const dateStr = ctx.message.text;
      const parsedDate = parseDate(dateStr);
      
      if (!parsedDate) {
        await ctx.reply("❌ Неправильный формат даты. Пожалуйста, введите дату в формате дд.мм.гггг (например, 25.12.2024):");
        return;
      }
      
      user.temp.deadline = dateStr;
      user.step = "collection_payment";
      saveUsers(u);
      await ctx.reply("Реквизиты / способ оплаты:");
    } 
    else if (user.step === "collection_payment") {
      user.temp.payment = ctx.message.text;
      
      const cols = collections();
      cols.push({ 
        id: Date.now(), 
        title: user.temp.title,
        amount: user.temp.amount,
        deadline: user.temp.deadline,
        payment: user.temp.payment, 
        paidUsers: {} 
      });
      saveCollections(cols);

      user.step = null;
      user.temp = null;
      saveUsers(u);

      await ctx.reply("✅ Сбор создан\n⏰ Напоминания о дедлайне будут приходить автоматически");
      await treasurerMenu(ctx);
    }
    return;
  }

  if (user.step === "poll_question") {
    if (!user.temp) user.temp = {};

    user.temp.question = ctx.message.text;
    const all = polls();
    const poll = { 
      id: Date.now(), 
      question: user.temp.question, 
      votes: {}, 
      closed: false 
    };
    all.push(poll);
    savePolls(all);

    Object.keys(u).filter(id => u[id] && u[id].role === "participant").forEach(id => {
      bot.api.sendMessage(id,
`━━━━━━━━━━━━━━━━
📊 Новый опрос
─────────────
${poll.question}
━━━━━━━━━━━━━━━━`).catch(e => console.log("Ошибка отправки уведомления:", e));
    });

    user.step = null;
    user.temp = null;
    saveUsers(u);

    await ctx.reply("✅ Опрос создан");
    await treasurerMenu(ctx);
    return;
  }
});

bot.callbackQuery("my_collections", async (ctx) => {
    await safeAnswer(ctx);
    const cols = collections();
    
    if (!cols.length) {
        const kb = new InlineKeyboard().text("⬅ Назад", "back");
        return await safeEditMessage(ctx, "Сборов пока нет", kb);
    }
    
    const kb = new InlineKeyboard();
    cols.forEach(c => kb.text(c.title, `open_col_${c.id}`).row());
    kb.text("⬅ Назад", "back");
    
    await safeEditMessage(ctx, "📂 Мои сборы:", kb);
});

function renderCollectionCard(c, u) {
    let deadlineInfo = "";
    const deadlineDate = parseDate(c.deadline);
    if (deadlineDate) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const deadlineDay = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
        const diffTime = deadlineDay - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > 0) {
            deadlineInfo = `⏰ Осталось дней: ${diffDays}`;
        } else if (diffDays === 0) {
            deadlineInfo = `🔴 Дедлайн сегодня!`;
        } else {
            deadlineInfo = `❌ Дедлайн прошёл`;
        }
    }
    
    let text =
`━━━━━━━━━━━━━━━━
📦 СБОР СРЕДСТВ
─────────────
На что собираем средства:
${c.title || "Не указано"}

Сумма:
${c.amount || "Не указана"}

Сдать средства до:
${c.deadline || "Не указано"}
${deadlineInfo ? `\n${deadlineInfo}` : ""}

Перечислять средства:
${c.payment || "Не указано"}
━━━━━━━━━━━━━━━━

👥 Участники:
`;

    Object.keys(u).filter(id => u[id] && u[id].role === "participant").forEach(id => {
        const date = c.paidUsers ? c.paidUsers[id] : null;
        text += date ? `✅ ${u[id].name} (${date})\n` : `❌ ${u[id].name}\n`;
    });
    
    return text;
}

bot.callbackQuery(/open_col_(\d+)/, async (ctx) => {
    await safeAnswer(ctx);
    const c = collections().find(x => x.id == ctx.match[1]);
    if (!c) return;
    
    const u = users();
    const text = renderCollectionCard(c, u);
    
    let keyboard;
    if (u[ctx.chat.id]?.role === "treasurer") {
        keyboard = new InlineKeyboard()
            .text("🔗 Дать ссылку", "share").row()
            .text("🗑 Удалить сбор", `delete_col_${c.id}`).row()
            .text("⬅ Назад", "my_collections");
    } else {
        keyboard = new InlineKeyboard()
            .text("🔗 Дать ссылку", "share").row()
            .text("⬅ Назад", "my_collections");
    }
    
    await safeEditMessage(ctx, text, keyboard);
});

bot.callbackQuery(/delete_col_(\d+)/, async (ctx) => {
    await safeAnswer(ctx);
    
    const c = collections().find(x => x.id == ctx.match[1]);
    if (!c) return;
    
    const text = `⚠️ **Вы уверены, что хотите удалить сбор?**

📌 ${c.title}

Это действие нельзя отменить!`;
    
    const keyboard = new InlineKeyboard()
        .text("✅ Да, удалить", `confirm_delete_${c.id}`).row()
        .text("❌ Нет, отмена", `open_col_${c.id}`);
    
    await safeEditMessage(ctx, text, keyboard);
});

bot.callbackQuery(/confirm_delete_(\d+)/, async (ctx) => {
    await safeAnswer(ctx);
    
    const cols = collections();
    const collectionId = parseInt(ctx.match[1]);
    const deletedCollection = cols.find(c => c.id == collectionId);
    
    if (!deletedCollection) {
        const kb = new InlineKeyboard().text("⬅ Назад", "my_collections");
        return await safeEditMessage(ctx, "❌ Сбор не найден", kb);
    }
    
    const newCollections = cols.filter(c => c.id != collectionId);
    saveCollections(newCollections);
    
    const u = users();
    Object.keys(u).filter(id => u[id] && u[id].role === "participant").forEach(id => {
        bot.api.sendMessage(id,
`━━━━━━━━━━━━━━━━
❌ СБОР УДАЛЁН
─────────────
Сбор "${deletedCollection.title}" был удалён казначеем.
━━━━━━━━━━━━━━━━`).catch(e => console.log("Ошибка отправки уведомления:", e));
    });
    
    const kb = new InlineKeyboard().text("📂 К моим сборам", "my_collections");
    await safeEditMessage(ctx, "✅ Сбор успешно удалён!", kb);
});

bot.callbackQuery("share", async (ctx) => {
    await safeAnswer(ctx);
    await ctx.reply(`🔗 Ссылка на бота:\nhttps://t.me/${ctx.me.username}`);
});

bot.callbackQuery("list_collections", async (ctx) => {
    await safeAnswer(ctx);
    const cols = collections();
    
    if (!cols.length) {
        const kb = new InlineKeyboard().text("⬅ Назад", "back");
        return await safeEditMessage(ctx, "Сборов нет", kb);
    }
    
    const kb = new InlineKeyboard();
    cols.forEach(c => kb.text(c.title, `pay_${c.id}`).row());
    kb.text("⬅ Назад", "back");
    
    await safeEditMessage(ctx, "💰 Сборы:", kb);
});

bot.callbackQuery(/pay_(\d+)/, async (ctx) => {
    await safeAnswer(ctx);
    const c = collections().find(x => x.id == ctx.match[1]);
    if (!c) return;
    
    if (c.paidUsers && c.paidUsers[ctx.chat.id]) {
        const kb = new InlineKeyboard().text("⬅ Назад", "back");
        return await safeEditMessage(ctx, `✅ Вы уже оплатили\n📅 ${c.paidUsers[ctx.chat.id]}`, kb);
    }

    const text = renderCollectionCard(c, users());
    const keyboard = new InlineKeyboard()
        .text("Я оплатил ✅", `paid_${c.id}`).row()
        .text("⬅ Назад", "back");
    
    await safeEditMessage(ctx, text, keyboard);
});

bot.callbackQuery(/paid_(\d+)/, async (ctx) => {
    await safeAnswer(ctx);
    const cols = collections();
    const c = cols.find(x => x.id == ctx.match[1]);
    if (!c) return;
    
    if (!c.paidUsers) c.paidUsers = {};
    if (!c.paidUsers[ctx.chat.id]) {
        c.paidUsers[ctx.chat.id] = new Date().toLocaleString();
        saveCollections(cols);
        
        const u = users();
        if (u && u.treasurerId) {
            const userName = u[ctx.chat.id]?.name || "Участник";
            bot.api.sendMessage(u.treasurerId,
`━━━━━━━━━━━━━━━━
💰 НОВАЯ ОПЛАТА
─────────────
Сбор: ${c.title}
Участник: ${userName}
Дата: ${c.paidUsers[ctx.chat.id]}
━━━━━━━━━━━━━━━━`).catch(e => console.log("Ошибка уведомления казначея:", e));
        }
    }
    
    const kb = new InlineKeyboard().text("⬅ Назад", "back");
    await safeEditMessage(ctx, `✅ Оплата сохранена\n📅 ${c.paidUsers[ctx.chat.id]}`, kb);
});

// =====================================================
// ===================== POLLS =======================
// =====================================================
bot.callbackQuery("my_polls", async (ctx) => {
    await safeAnswer(ctx);
    const allPolls = polls();
    
    if (!allPolls.length) {
        const kb = new InlineKeyboard().text("⬅ Назад", "back");
        return await safeEditMessage(ctx, "Опросов пока нет", kb);
    }
    
    const kb = new InlineKeyboard();
    allPolls.forEach(p => {
        const shortTitle = p.question.substring(0, 20) + (p.question.length > 20 ? "..." : "");
        kb.text(shortTitle, `poll_admin_${p.id}`).row();
    });
    kb.text("⬅ Назад", "back");
    
    await safeEditMessage(ctx, "📝 Мои опросы:", kb);
});

function renderPollCard(p) {
    const yes = Object.values(p.votes || {}).filter(v => v === "yes").length;
    const no = Object.values(p.votes || {}).filter(v => v === "no").length;
    const total = yes + no || 1;
    
    return `
━━━━━━━━━━━━━━━━
📊 ${p.question}
─────────────
👍 Да: ${yes} (${Math.round(yes / total * 100)}%)
👎 Нет: ${no} (${Math.round(no / total * 100)}%)
Статус: ${p.closed ? "🔒 Закрыт" : "🟢 Открыт"}
━━━━━━━━━━━━━━━━`;
}

bot.callbackQuery(/poll_admin_(\d+)/, async (ctx) => {
    await safeAnswer(ctx);
    const p = polls().find(x => x.id == ctx.match[1]);
    if (!p) return;
    
    const text = renderPollCard(p);
    const keyboard = new InlineKeyboard()
        .text(!p.closed ? "🔒 Закрыть" : "🔒 Закрыт", `poll_close_${p.id}`).row()
        .text("🗑 Удалить", `poll_delete_${p.id}`).row()
        .text("⬅ Назад", "my_polls");
    
    await safeEditMessage(ctx, text, keyboard);
});

bot.callbackQuery(/poll_close_(\d+)/, async (ctx) => { 
    await safeAnswer(ctx); 
    const all = polls();
    const p = all.find(x => x.id == ctx.match[1]); 
    if (!p) return; 
    
    p.closed = true; 
    savePolls(all); 
    await ctx.editMessageText("🔒 Опрос закрыт"); 
});

bot.callbackQuery(/poll_delete_(\d+)/, async (ctx) => { 
    await safeAnswer(ctx); 
    savePolls(polls().filter(p => p.id != ctx.match[1])); 
    await ctx.editMessageText("🗑 Опрос удалён"); 
});

bot.callbackQuery("list_polls", async (ctx) => { 
    await safeAnswer(ctx); 
    const allPolls = polls();
    
    if (!allPolls.length) {
        const kb = new InlineKeyboard().text("⬅ Назад", "back");
        return await safeEditMessage(ctx, "Опросов нет", kb);
    }
    
    const kb = new InlineKeyboard(); 
    allPolls.forEach(p => {
        const shortTitle = p.question.substring(0, 20) + (p.question.length > 20 ? "..." : "");
        kb.text(shortTitle, `poll_${p.id}`).row();
    }); 
    kb.text("⬅ Назад", "back"); 
    
    await safeEditMessage(ctx, "📊 Опросы:", kb);
});

bot.callbackQuery(/poll_(\d+)/, async (ctx) => {
    await safeAnswer(ctx);
    const p = polls().find(x => x.id == ctx.match[1]);
    if (!p) return;
    
    if (p.closed) {
        const kb = new InlineKeyboard().text("⬅ Назад", "list_polls");
        return await safeEditMessage(ctx, "🔒 Опрос закрыт", kb);
    }
    
    if (p.votes && p.votes[ctx.chat.id]) {
        const kb = new InlineKeyboard().text("⬅ Назад", "list_polls");
        return await safeEditMessage(ctx, "❌ Вы уже голосовали", kb);
    }

    const text = `━━━━━━━━━━━━━━━━\n📊 ${p.question}\n━━━━━━━━━━━━━━━━`;
    const keyboard = new InlineKeyboard()
        .text("👍 Да", `vote_${p.id}_yes`).row()
        .text("👎 Нет", `vote_${p.id}_no`).row()
        .text("⬅ Назад", "list_polls");
    
    await safeEditMessage(ctx, text, keyboard);
});

bot.callbackQuery(/vote_(\d+)_(yes|no)/, async (ctx) => {
    await safeAnswer(ctx);
    const all = polls();
    const p = all.find(x => x.id == ctx.match[1]);
    if (!p || p.closed) return;
    
    if (!p.votes) p.votes = {};
    if (!p.votes[ctx.chat.id]) {
        p.votes[ctx.chat.id] = ctx.match[2];
        savePolls(all);
    }

    const u = users();
    if (u && u.treasurerId) {
        bot.api.sendMessage(u.treasurerId, renderPollCard(p))
            .catch(e => console.log("Ошибка уведомления казначея:", e));
    }

    const kb = new InlineKeyboard().text("⬅ Назад", "list_polls");
    await safeEditMessage(ctx, "✅ Голос принят", kb);
});

bot.callbackQuery("back", async (ctx) => {
    await safeAnswer(ctx);
    const u = users();
    const user = u[ctx.chat.id];
    
    if (user) {
        if (user.role === "treasurer") {
            await treasurerMenu(ctx);
        } else {
            await participantMenu(ctx);
        }
    } else {
        await ctx.reply("Пожалуйста, используйте /start");
    }
});

bot.command("reset_treasurer", async (ctx) => {
    const u = users();

    if (!u.treasurerId) {
        return ctx.reply("❌ Казначей уже не назначен.");
    }

    delete u.treasurerId;
    if (u[ctx.chat.id]) {
        u[ctx.chat.id].role = "participant"; 
    }
    saveUsers(u);

    await ctx.reply("✅ Казначей сброшен. Следующий, кто введет правильный пароль, станет новым казначеем.");
});

// ================ ВЕБ-СЕРВЕР ДЛЯ RENDER ================
// Простой сервер только для того, чтобы Render не ругался
app.get('/', (req, res) => {
    res.send('Бот работает! 🤖');
});

// Запускаем сервер и бота
app.listen(port, () => {
    console.log(`🚀 Веб-сервер запущен на порту ${port}`);
    
    // Настраиваем меню и запускаем бота
    setupMenuButton();
    startDeadlineChecker();
    
    // Запускаем бота в режиме long polling (НЕ webhook)
    bot.start();
    
    console.log("🤖 Бот запущен и готов к работе!");
    console.log("⏰ Напоминания о дедлайнах активны (проверка каждый час)");
});