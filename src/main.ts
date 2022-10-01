import {
  paths,
  parseConfig,
  isTag,
  unmatchedPatterns,
  uploadUrl
} from "./util";
import { release, upload, GitHubReleaser, printRateLimitStats } from "./github";
import { getOctokit } from "@actions/github";
import { setFailed, setOutput } from "@actions/core";
import { GitHub, getOctokitOptions } from "@actions/github/lib/utils";

import { env } from "process";
import { appendFileSync } from "fs";

async function run() {
  try {
    const config = parseConfig(env);
    if (
      !config.input_tag_name &&
      !isTag(config.github_ref) &&
      !config.input_draft
    ) {
      throw new Error(`⚠️ GitHub Releases requires a tag`);
    }
    if (config.input_files) {
      const patterns = unmatchedPatterns(config.input_files);
      patterns.forEach(pattern =>
        console.warn(`🤔 Pattern '${pattern}' does not match any files.`)
      );
      if (patterns.length > 0 && config.input_fail_on_unmatched_files) {
        throw new Error(`⚠️ There were unmatched files`);
      }
    }

    // const oktokit = GitHub.plugin(
    //   require("@octokit/plugin-throttling"),
    //   require("@octokit/plugin-retry")
    // );

    const gh = getOctokit(config.github_token, {
      //new oktokit(
      throttle: {
        onRateLimit: (retryAfter, options) => {
          console.warn(
            `Request quota exhausted for request ${options.method} ${options.url}`
          );
          if (options.request.retryCount === 0) {
            // only retries once
            console.log(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onAbuseLimit: (retryAfter, options) => {
          // does not retry, only logs a warning
          console.warn(
            `Abuse detected for request ${options.method} ${options.url}`
          );
        }
      }
    });
    //);
    const github = new GitHubReleaser(gh);

    if(config.input_print_debug) {
      await printRateLimitStats(github);
    }

    const rel = await release(config, github);
    if (config.input_files) {
      const files = paths(config.input_files);
      if (files.length == 0) {
        console.warn(`🤔 ${config.input_files} not include valid file.`);
      }
      const currentAssets = rel.assets;
      let assets: any[] = [];

      if(config.input_sequential_upload) {
        for(let i = 0; i < files.length; i += 1) {
          const path = files[i];

          const json = await upload(
            config,
            gh,
            uploadUrl(rel.upload_url),
            path,
            currentAssets,
            rel.id
          );

          delete json.uploader;
          assets.push(json);
        }
      } else {
        assets = await Promise.all(
          files.map(async path => {
            const json = await upload(
              config,
              gh,
              uploadUrl(rel.upload_url),
              path,
              currentAssets,
              rel.id
            );
            delete json.uploader;
            return json;
          })
        ).catch(async (error) => {
          if(config.input_print_debug) {
            await printRateLimitStats(github);
          }

          throw error;
        });
      }
      setOutput("assets", assets);
    }

    console.log(`🎉 Release ready at ${rel.html_url}`);
    if(config.input_print_debug) {
      await printRateLimitStats(github);
    }

    setOutput("url", rel.html_url);
    setOutput("id", rel.id.toString());
    setOutput("upload_url", rel.upload_url);
  } catch (error) {
    setFailed(error.message);
  }
}

run();
