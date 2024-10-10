import { Route } from '@/types';
import cache from '@/utils/cache';
import { config } from '@/config';
import * as cheerio from 'cheerio';
import got from '@/utils/got';
import { formatNote, formatText, getNotes } from './util';

export const route: Route = {
    path: '/user/:user_id/notes/:fulltext',
    radar: [
        {
            source: ['xiaohongshu.com/user/profile/:user_id'],
            target: '/user/:user_id/notes',
        },
    ],
    name: '用户笔记 全文',
    maintainers: ['howerhe'],
    handler,
    example: '/xiaohongshu/user/52d8c541b4c4d60e6c867480/notes/fulltext',
    features: {
        requireConfig: [
            {
                name: 'XIAOHONGSHU_COOKIE',
                optional: true,
                description: '小红书 cookie 值，可在浏览器控制台通过`document.cookie`获取。',
            },
        ],
        antiCrawler: true,
        requirePuppeteer: true,
    },
    parameters: {
        user_id: 'user id, length 24 characters',
        fulltext: {
            description: '是否获取全文',
            default: '',
        },
    },
};

async function handler(ctx) {
    const userId = ctx.req.param('user_id');
    const url = `https://www.xiaohongshu.com/user/profile/${userId}`;

    if (config.xiaohongshu.cookie && ctx.req.param('fulltext')) {
        const user = await getUser(url, config.xiaohongshu.cookie);
        const notes = await renderNotesFulltext(user.notes, url);
        return {
            title: `${user.userPageData.basicInfo.nickname} - 笔记 • 小红书 / RED`,
            description: user.userPageData.basicInfo.desc,
            image: user.userPageData.basicInfo.imageb || user.userPageData.basicInfo.images,
            link: url,
            item: notes,
        };
    } else {
        const { user, notes } = await getNotes(url, cache);
        return {
            title: `${user.nickname} - 笔记 • 小红书 / RED`,
            description: formatText(user.desc),
            image: user.imageb || user.images,
            link: url,
            item: notes.map((item) => formatNote(url, item)),
        };
    }
}

async function getUser(url, cookie) {
    const res = await got(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Cookie: cookie,
        },
    });
    const $ = cheerio.load(res.data);

    let script = $('script')
        .filter((i, script) => {
            const text = script.children[0]?.data;
            return text?.startsWith('window.__INITIAL_STATE__=');
        })
        .text();
    script = script.slice('window.__INITIAL_STATE__='.length);
    script = script.replaceAll('undefined', 'null');
    const state = JSON.parse(script);
    return state.user;
}

async function renderNotesFulltext(notes, url) {
    const data: any[] = [];
    for (const note of notes) {
        for (const { noteCard } of note) {
            const link = `${url}/${noteCard.noteId}`;
            // eslint-disable-next-line no-await-in-loop
            const { title, description } = await getFullNote(link);
            data.push({
                title,
                link,
                description,
                author: noteCard.user.nickName,
                guid: noteCard.noteId,
            });
        }
    }
    return data;
}

async function getFullNote(link) {
    const cookie = config.xiaohongshu.cookie;
    const data = (await cache.tryGet(link, async () => {
        const res = await got(link, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                Cookie: cookie,
            } as any,
        });
        const $ = cheerio.load(res.data);
        let script = $('script')
            .filter((i, script) => {
                const text = script.children[0]?.data;
                return text?.startsWith('window.__INITIAL_STATE__=');
            })
            .text();
        script = script.slice('window.__INITIAL_STATE__='.length);
        script = script.replaceAll('undefined', 'null');
        const state = JSON.parse(script);
        const note = state.note.noteDetailMap[state.note.firstNoteId].note;
        const images = note.imageList.map((image) => image.urlDefault);
        const title = note.title;
        let desc = note.desc;
        desc = desc.replaceAll(/\[.*?\]/g, '');
        desc = desc.replaceAll(/#(.*?)#/g, '#$1');
        desc = desc.replaceAll('\n', '<br>');
        const description = `${images.map((image) => `<img src="${image}">`).join('')}<br>${title}<br>${desc}`;
        return {
            title,
            description,
        };
    })) as Promise<{ title: string; description: string }>;
    return data;
}
