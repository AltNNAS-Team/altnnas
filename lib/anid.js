const logger = require("logger");
const xmlbuilder = require("xmlbuilder");
const knex = require("db");
const utils = require("utils");
const nn_error = require("nn_error");
const moment = require("moment");
const config = require("../config.json");
const bcrypt = require("bcrypt");

const crypto = require("node:crypto");

const anid = {
    async createUser(platformId, deviceId, birth_date, user_id, password, country, language, tz_name, agreement, email, mii, parental_consent, gender, region, marketing_flag, uuid_account, uuid_common, persistent_id, transferable_id_base, transferable_id_base_common, off_device_flag) {
        logger.log(`[anid]: Attempting to create user ${user_id}`);
        if (agreement[0].type != "NINTENDO-NETWORK-EULA") { // TODO: check if agreed to current version
            logger.warn(`[anid]: User creation failed due to incorrect agreement type, agreement type is ${agreement[0].type}`);
            return false; // we don't know what agreement you're agreeing to...
        }

        // XML is preparsed and sent to the function
        knex("people")
            .insert({
                birth_date: birth_date,
                user_id: user_id,
                country: country,
                language: language,
                tz_name: tz_name,
                gender: gender,
                region: region,
                marketing_flag: marketing_flag,
                off_device_flag: off_device_flag,
                uuid_account: uuid_account,
                uuid_common: uuid_common,
                persistent_id: persistent_id,
                transferable_id_base: transferable_id_base,
                transferable_id_base_common: transferable_id_base_common,
                deviceId_wup: platformId == 1 ? deviceId : null,
                deviceId_ctr: platformId == 0 ? deviceId : null
            })
            .then(function () {
                knex.select('id')
                    .from('people')
                    .where('user_id', user_id.toString())
                    .then(rows => {
                        if (rows.length != 0) {
                            const pid = rows[0].id;
                            const hash = crypto.randomBytes(8).toString("hex");
                            bcrypt.hash(utils.nintendoPasswordHash(password, pid), config.encryption_keys.saltRounds, function (err, hash) {
                                if (err) throw err;
                                knex('people').where('id', pid).update({ password: hash })
                                    .then(function () {
                                        knex("mii").insert({
                                            pid: pid,
                                            name: mii[0].name,
                                            primary_mii: mii[0].primary,
                                            data: mii[0].data.toString().replace("\n", ""),
                                            hash: crypto.randomBytes(7).toString('hex').slice(0, 13),
                                            status: "COMPLETED",
                                        })
                                            /*.then(function () {
                                                knex("mii_images")
                                                    .insert({
                                                        pid: pid,
                                                        cached_url: "https://mii-secure.account.nintendo.net/1muiw9qf8bqw0_standard.tga", // TODO: mii images (and explode)
                                                        url: "https://mii-secure.account.nintendo.net/1muiw9qf8bqw0_standard.tga",
                                                        type: "standard"
                                                    })*/
                                            .then(function () {
                                                knex("parental_consent").insert({
                                                    pid: pid,
                                                    scope: parental_consent[0].scope,
                                                    consent_date: parental_consent[0].consent_date,
                                                    approval_id: parental_consent[0].approval_id
                                                })
                                                    .then(function () {
                                                        knex("emails")
                                                            .insert({
                                                                pid: pid,
                                                                email: email[0].address,
                                                                reachable: "Y",
                                                                type: "DEFAULT",
                                                                validated: "N"
                                                            })
                                                            .then(function () {
                                                                const location = agreement[0].location.toString().replace("nintendo.net", "termy.lol"); // you never know!!
                                                                knex("user_agreements")
                                                                    .insert({
                                                                        pid: pid,
                                                                        agreement_date: agreement[0].agreement_date,
                                                                        location: location,
                                                                        country: agreement[0].country,
                                                                        type: agreement[0].type,
                                                                        version: agreement[0].version
                                                                    })
                                                                    .then(function () {
                                                                        return pid;
                                                                    })
                                                                    .catch(err => {
                                                                        console.error(err);
                                                                        return false;
                                                                    })
                                                            })
                                                            .catch(err => {
                                                                console.error(err);
                                                                return false;
                                                            })
                                                    })
                                                    .catch(err => {
                                                        console.error(err);
                                                        return false;
                                                    })
                                            })
                                            .catch(err => {
                                                console.error(err);
                                                return false;
                                            })
                                        /*})
                                        .catch(err => {
                                            console.error(err);
                                            return false;
                                        })*/
                                    })
                                    .catch(err => {
                                        console.error(err);
                                        return false;
                                    })
                            });
                        } else {
                            logger.error(`[anid]: Failed to fetch data from profile! No rows`);
                            return false;
                        }
                    })
                    .catch(err => {
                        console.error(err);
                        return false;
                    })
                return true;
            })
            .catch(err => {
                console.error(err);
                return false;
            })
    },

    async getUserDataByToken(token) {
        // sigh
        if (token.toString().includes("Bearer")) {
            token = token.toString().slice(7)
        }
        return await knex.select('pid', 'expires').from('access_tokens').where('token', token)
            .then(async rows => {
                if (rows.length == 0) {
                    return false;
                } else if (moment(rows[0].expires).isBefore(moment())) {
                    return false;
                } else {
                    return await knex.select('*').from('people').where('id', rows[0].pid)
                        .then(async rows => {
                            if (rows.length == 0) {
                                return false;
                            } else {
                                var data = JSON.parse(JSON.stringify(rows[0]));
                                return await knex.select('*').from('mii').where('pid', rows[0].id)
                                    .then(async rows => {
                                        if (rows.length == 0) {
                                            return false;
                                        } else {
                                            data.mii = rows[0];
                                            return await knex.select('*').from('emails').where('pid', rows[0].pid)
                                                .then(rows => {
                                                    if (rows.length == 0) {
                                                        return false;
                                                    } else {
                                                        data.email = rows[0];
                                                        return data;
                                                    }
                                                })
                                        }
                                    })
                                    .catch(err => {
                                        console.error(err);
                                        return false;
                                    })
                            }
                        })
                        .catch(err => {
                            console.error(err);
                            return false;
                        })
                }
            })
            .catch(err => {
                console.error(err);
                return false;
            })
    },

    async getUserDataByPid(pid) {
        return await knex.select('*').from('people').where('id', pid)
            .then(async rows => {
                if (rows.length == 0) {
                    return false;
                } else {
                    var data = JSON.parse(JSON.stringify(rows[0]));
                    return await knex.select('*').from('mii').where('pid', rows[0].id)
                        .then(async rows => {
                            if (rows.length == 0) {
                                return false;
                            } else {
                                data.mii = rows[0];
                                return await knex.select('*').from('emails').where('pid', rows[0].pid)
                                    .then(rows => {
                                        if (rows.length == 0) {
                                            return false;
                                        } else {
                                            data.email = rows[0];
                                            return data;
                                        }
                                    })
                            }
                        })
                        .catch(err => {
                            console.error(err);
                            return false;
                        })
                }
            })
            .catch(err => {
                console.error(err);
                return false;
            })
        },

        async getUserDataByUserId(user) {
            return await knex.select('*').from('people').where('user_id', user)
                .then(async rows => {
                    if (rows.length == 0) {
                        return false;
                    } else {
                        var data = JSON.parse(JSON.stringify(rows[0]));
                        return await knex.select('*').from('mii').where('pid', rows[0].id)
                            .then(async rows => {
                                if (rows.length == 0) {
                                    return false;
                                } else {
                                    data.mii = rows[0];
                                    return await knex.select('*').from('emails').where('pid', rows[0].pid)
                                        .then(rows => {
                                            if (rows.length == 0) {
                                                return false;
                                            } else {
                                                data.email = rows[0];
                                                return data;
                                            }
                                        })
                                }
                            })
                            .catch(err => {
                                console.error(err);
                                return false;
                            })
                    }
                })
                .catch(err => {
                    console.error(err);
                    return false;
                })
            }
    }

module.exports = anid;
