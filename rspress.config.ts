import { defineConfig } from '@rspress/core';

const zhSidebar = {
    '/': [
        {
            text: '开始',
            items: [
                { text: '简介', link: '/index' },
                { text: '安装指南', link: '/guide/installation' },
            ],
        },
        {
            text: '使用指南',
            items: [
                {
                    text: '从零构建人工语言',
                    link: '/guide/getting-started',
                },
            ],
        },
        {
            text: '功能模块',
            items: [
                { text: '音系', link: '/modules/phonology' },
                { text: '词典', link: '/modules/lexicon' },
                { text: '造词生成器', link: '/modules/wordgen' },
                { text: '语法', link: '/modules/grammar' },
                { text: '翻译沙盒', link: '/modules/sandbox' },
                { text: '语料库', link: '/modules/corpus' },
                { text: '语系树', link: '/modules/family-tree' },
                { text: '历时音变引擎', link: '/modules/sca' },
                { text: '导出与导入', link: '/modules/export-import' },
            ],
        },
    ],
};

const enSidebar = {
    '/en/': [
        {
            text: 'Getting Started',
            items: [
                { text: 'Introduction', link: '/en/index' },
                { text: 'Installation', link: '/en/guide/installation' },
            ],
        },
        {
            text: 'User Guide',
            items: [
                {
                    text: 'Build a Conlang from Scratch',
                    link: '/en/guide/getting-started',
                },
            ],
        },
        {
            text: 'Modules',
            items: [
                { text: 'Phonology', link: '/en/modules/phonology' },
                { text: 'Lexicon', link: '/en/modules/lexicon' },
                { text: 'Word Generator', link: '/en/modules/wordgen' },
                { text: 'Grammar', link: '/en/modules/grammar' },
                {
                    text: 'Translation Sandbox',
                    link: '/en/modules/sandbox',
                },
                { text: 'Corpus', link: '/en/modules/corpus' },
                { text: 'Family Tree', link: '/en/modules/family-tree' },
                {
                    text: 'Sound Change Applier',
                    link: '/en/modules/sca',
                },
                {
                    text: 'Export & Import',
                    link: '/en/modules/export-import',
                },
            ],
        },
    ],
};

export default defineConfig({
    root: 'docs',
    base: '/conlang-maker/',
    title: 'Conlang Maker',
    description: '人工语言全流程创作工具',
    lang: 'zh',
    locales: [
        { lang: 'zh', label: '中文' },
        { lang: 'en', label: 'English' },
    ],
    themeConfig: {
        socialLinks: [
            {
                icon: 'github',
                mode: 'link',
                content: 'https://github.com/wumail/conlang-maker',
            },
        ],
        footer: {
            message: 'Released under the MIT License.',
        },
        locales: [
            {
                lang: 'zh',
                label: '中文',
                title: 'Conlang Maker',
                description: '人工语言全流程创作工具',
                sidebar: zhSidebar,
            },
            {
                lang: 'en',
                label: 'English',
                title: 'Conlang Maker',
                description:
                    'A full-pipeline desktop tool for constructing languages',
                sidebar: enSidebar,
            },
        ],
    },
});
