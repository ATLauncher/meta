const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const sha1 = require('sha1');
const base64 = require('base-64');
const { DateTime } = require('luxon');
const { createHash } = require('crypto');
const octokitRest = require('@octokit/rest');

const github = require('../../github.json');

const octokit = octokitRest({
    requestMedia: 'application/vnd.github.v3+json',
    headers: {
        'user-agent': 'octokit/rest.js v15.2.6'
    },
});

if (!process.env.GITHUB_ACCESS_TOKEN) {
    console.error('GITHUB_ACCESS_TOKEN environment variable must be provided.');
    process.exit(1);
}

octokit.authenticate({
    type: 'token',
    token: process.env.GITHUB_ACCESS_TOKEN
})

github.repositories.filter(({ updateTemplateFiles }) => updateTemplateFiles).forEach(async ({ owner, repo }) => {
    console.log(`Updating template files for project ${owner}/${repo}`);

    try {
        const { data: repoData } = await octokit.repos.get({ owner, repo })

        // get the year the repository was created
        const { year: yearCreated } = DateTime.fromISO(repoData.created_at);

        const templateMetaData = {
            year: yearCreated
        };

        github.templateFiles.forEach(async (templateFile) => {
            const template = _.template(fs.readFileSync(path.resolve(__dirname, '../../template', templateFile)));

            const updatedFileData = template(templateMetaData);
            const updatedBase64data = base64.encode(updatedFileData);
            const updatedFileSha = sha1(updatedFileData);

            try {
                const { data: existingFile } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: templateFile,
                    ref: 'master'
                });

                const oldFileData = base64.decode(existingFile.content);
                const oldBase64data = base64.encode(oldFileData);
                const oldFileSha = sha1(oldFileData);

                const fileUpToDate = _.isEqual(oldFileData, updatedFileData);

                if (fileUpToDate) {
                    console.log(`File '${templateFile}' already up to date for project ${owner}/${repo}`);
                    return;
                }

                console.log(`Updating '${templateFile}' for project ${owner}/${repo}`);

                await octokit.repos.updateFile({
                    owner,
                    repo,
                    path: templateFile,
                    message: `chore: update ${templateFile}`,
                    content: updatedBase64data,
                    sha: existingFile.sha,
                    committer: {
                        name: 'ATLauncher Meta Bot',
                        email: 'no-reply@atlauncher.com'
                    },
                    branch: 'master',
                });
            } catch (e) {
                if (e.code !== 404) {
                    throw (e);
                    return;
                }

                console.log(`Creating file '${templateFile}' for project ${owner}/${repo}`);

                await octokit.repos.createFile({
                    owner,
                    repo,
                    path: templateFile,
                    message: `chore: add ${templateFile}`,
                    content: updatedBase64data,
                    committer: {
                        name: 'ATLauncher Meta Bot',
                        email: 'no-reply@atlauncher.com'
                    },
                    branch: 'master',
                });

                return;
            }
        });
    } catch (e) {
        console.log('-----');
        console.error(`[${owner}/${repo}] Error from GitHub:`)
        console.log();
        console.error(e);
        process.exit(1);
    }
});
