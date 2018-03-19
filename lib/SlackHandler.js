"use strict";

const EventEmitter = require("events").EventEmitter;
const util = require("util");
const rp = require("request-promise");

/**
 * Represents a Marathon Event Listener
 * @constructor
 * @param {object} options - The option map object.
 */
function SlackHandler (options) {

    if (!(this instanceof SlackHandler)) {
        return new SlackHandler(options);
    }

    // Inherit from EventEmitter
    EventEmitter.call(this);

    let self = this;

    self.defaultWebhook = options.slackWebHook || process.env.SLACK_WEBHOOK_URL;
    self.slackChannel = options.slackChannel || process.env.SLACK_CHANNEL || "#marathon";
    self.slackBotName = options.slackBotName || process.env.SLACK_BOT_NAME || "Marathon Event Bot";
    self.environment = options.environment || process.env.ENVIRONMENT || "Unknown";
    self.region = options.region || process.env.REGION || "Unknown";
    self.projects = options.projects || process.env.PROJECTS || {};
}

// Inherit from EventEmitter
util.inherits(SlackHandler, EventEmitter);

function toUnixTimestamp (dateString) {
    return parseInt((new Date(dateString).getTime() / 1000).toFixed(0));
}

function prepareDateToken (dateString) {
    return "`<!date^" + toUnixTimestamp(dateString) + "^{date_num} {time_secs}|" + dateString + ">`";
}

SlackHandler.prototype.renderMessage = function (event) {

    let self = this;

    self.emit("received_event", {
        timestamp: event.data.timestamp,
        eventType: event.type,
        data: event.data
    });
    
    function parseEvents (event) {

        let message = {
            "username": self.slackBotName,
            "icon_url": "http://i.imgur.com/5FJDbGz.png",
            "mrkdwn": true,
            "projects" : []
        };

        let attachment = {};

        switch (event.type) {

            case "deployment_info":
                attachment = {
                    "fallback": "Deployment was triggered.",
                    "title": "Deployment info",
                    "text": "The deployment `" + event.data.plan.id + "` triggered step `" + event.data.currentStep.actions[0].action + "` of the following steps:",
                    "fields": [],
                    "color": "#0066cc",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                let diSteps = 1;
                event.data.plan.steps.forEach(function (step) {
                    step.actions.forEach(function (action) {
                        attachment.fields.push({
                            "title": diSteps.toString() + ". " + (action.action ? action.action : (action.type ? action.type : "Step")),
                            "value": action.app,
                            "short": true
                        });
                        diSteps++;
                    });
                });
                message.attachments = [attachment];
                break;
            case "deployment_success":               
                var text = "The deployment `" + event.data.id + "` was completed successfully at " + prepareDateToken(event.data.timestamp);
                text += "\nApps affected:";                

                diSteps = 1;
                event.data.plan.steps.forEach(function (step) {
                    step.actions.forEach(function (action) {
                        if (diSteps > 1) {
                            text += "\n\t";
                        }

                        text += "\t" + diSteps.toString() + ") `" + action.app + "`";    
                        diSteps++;

                        var projectName = null;
                        var appNames = action.app.split("/");
                        var groupName = "/";
                        if (appNames.length > 2) {
                            groupName = "/" + appNames[1];
                            projectName = appNames[1];
                        }

                        if(self.projects.hasOwnProperty(projectName)){
                            message.projects.push(projectName);
                        }

                        switch (action.action) {
                            case "RestartApplication": {
                                text += " was restarted";
                                break;
                            }
        
                            case "ScaleApplication": {
                                var numInstances = 0;
                                if (groupName === "/") {
                                    for (var appIter = 0; appIter < event.data.plan.target.apps.length; appIter++) {
                                        
                                        if (event.data.plan.target.apps[appIter].id === action.app) {
                                            numInstances = event.data.plan.target.apps[appIter].instances;
                                        }
                                    }
                                }
                                else {
                                    for (var groupIter = 0; groupIter < event.data.plan.target.groups.length; groupIter++) {
                                        if (event.data.plan.target.groups[groupIter].id === groupName) {
                                            for (var groupAppIter = 0; groupAppIter < event.data.plan.target.groups[groupIter].apps.length; groupAppIter++) {                                            
                                                if (event.data.plan.target.groups[groupIter].apps[groupAppIter].id === action.app) {
                                                    numInstances = event.data.plan.target.groups[groupIter].apps[groupAppIter].instances;
                                                    break;
                                                }
                                            }

                                            break;
                                        }                                        
                                    }
                                }
                                
                                text += " was scaled to " + numInstances + " instances";
                                break;
                            }
        
                            default: {
                                text += " was " + action.action;
                                break;
                            }
                        }
                    });
                });

                text += "\nEnvironment: `" + self.environment + "`";
                text += "\nRegion: `" + self.region + "`";

                attachment = {
                    "fallback": "Deployment was successful.",
                    "title": "Deployment success",
                    "text": "The deployment `" + event.data.id + "` was completed successfully at " + prepareDateToken(event.data.timestamp),
                    "color": "#7CD197",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;
            case "deployment_failed":
                attachment = {
                    "fallback": "Deployment failed.",
                    "title": "Deployment failed",
                    "text": "The deployment `" + event.data.id + "` failed at " + prepareDateToken(event.data.timestamp),
                    "color": "#ff0000",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;
            case "deployment_step_success":
                attachment = {
                    "fallback": "Deployment step was completed.",
                    "title": "Deployment step(s) success",
                    "text": "The deployment `" + event.data.plan.id + "` completed the following steps:",
                    "fields": [],
                    "color": "#7CD197",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                let dssSteps = 1;
                event.data.plan.steps.forEach(function (step) {
                    step.actions.forEach(function (action) {
                        attachment.fields.push({
                            "title": dssSteps.toString() + ". " + (action.action ? action.action : (action.type ? action.type : "Step")),
                            "value": action.app,
                            "short": true
                        });
                        dssSteps++;
                    });
                });
                message.attachments = [attachment];
                break;
            case "deployment_step_failure":
                attachment = {
                    "fallback": "Deployment step failed.",
                    "title": "Deployment step(s) failed",
                    "text": "The deployment `" + event.data.plan.id + "` failed at the following steps:",
                    "fields": [],
                    "color": "#ff0000",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                let dsfSteps = 1;
                event.data.plan.steps.forEach(function (step) {
                    step.actions.forEach(function (action) {
                        attachment.fields.push({
                            "title": dsfSteps.toString() + ". " + (action.action ? action.action : (action.type ? action.type : "Step")),
                            "value": action.app,
                            "short": true
                        });
                        dsfSteps++;
                    });
                });
                message.attachments = [attachment];
                break;
            case "group_change_success":
                attachment = {
                    "fallback": "Group change was completed.",
                    "title": "Group change completed",
                    "text": "The group `" + event.data.groupId + "` completed at " + prepareDateToken(event.data.timestamp) + ".",
                    "color": "#7CD197",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;
            case "group_change_failed":
                attachment = {
                    "fallback": "Group change failed.",
                    "title": "Group change failed",
                    "text": "The group `" + event.data.groupId + "` failed at " + prepareDateToken(event.data.timestamp) + ".",
                    "color": "#ff0000",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;
            case "failed_health_check_event":
                attachment = {
                    "fallback": "App health check failed.",
                    "title": "App health check failed",
                    "text": "The app `" + event.data.appId + "` (with task id `" + event.data.taskId + "`) failed its health check at " + prepareDateToken(event.data.timestamp),
                    "color": "#ff9900",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;
            case "health_status_changed_event":
            let taskOrInstanceInfo = "` (with task id `" + event.data.taskId + "`)";
                if(event.data.instanceId) {
                    taskOrInstanceInfo = "` (with instance id `" + event.data.instanceId + "`)"
                }
                attachment = {
                    "fallback": "App health status changed.",
                    "title": "App health check status changed",
                    "text": "The app `" + event.data.appId + taskOrInstanceInfo + " changed its health check status at " + prepareDateToken(event.data.timestamp) + " to " + (event.data.alive ? "*healthy*" : "*unhealthy*"),
                    "color": (event.data.alive ? "#7CD197" : "#ff0000"),
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;
            case "unhealthy_task_kill_event":
                attachment = {
                    "fallback": "Unhealthy task was killed.",
                    "title": "Unhealthy task was killed",
                    "text": "The app `" + event.data.appId + "` had its task with id `" + event.data.taskId + "` killed at " + prepareDateToken(event.data.timestamp) + " due to an '" + event.data.reason + "' error",
                    "color": "#ff0000",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;
            case "status_update_event":
                attachment = self.prepareStatusUpdateAttachment(event);
                
                message.attachments = [attachment];
                break;
            default:
                attachment = {
                    "fallback": "Event type " + event.type + " received.",
                    "title": "Event type " + event.type + " received.",
                    "text": "An event of type " + event.type + " was received.",
                    "color": "#0066cc",
                    "mrkdwn_in": ["text"],
                    "ts": toUnixTimestamp(event.data.timestamp)
                };
                message.attachments = [attachment];
                break;

        }

        return message;

    }

    return parseEvents(event);

};

SlackHandler.prototype.prepareStatusUpdateAttachment = function (event) {
    let title = "Task Status Update - ";
    let color = "#0066cc";
    
    switch (event.data.taskStatus) {
        case "TASK_FAILED":
            title += "Task failed";
            color = "#ff0000";

            break;
        case "TASK_KILLED":
            title += "Task killed";
            color = "#ff0000";
            
            break;
        case "TASK_LOST":
            title += "Task lost";
            color = "#ff0000";
            
            break;
        case "TASK_RUNNING":
            title += "Task running";
            color = "#7CD197";

            break;
        case "TASK_KILLING":
            title += "Task killing";
            color = "#0066cc";
            
            break;
        case "TASK_FINISHED":
            title += "Task finished";
            color = "#0066cc";

            break;
        case "TASK_STAGING":
            title += "Task staging";
            color = "#0066cc";

            break;
        case "TASK_STARTING":
            title += "Task starting";
            color = "#0066cc";

            break;
        default:
            title += event.data.taskStatus;
            
            break;
    }
    
    const attachment = {
        "fallback": title,
        "title": title,
        "text": "The app `" + event.data.appId + "` (with task id `" + event.data.taskId + "`) changed its status to `" + event.data.taskStatus + "` at " + prepareDateToken(event.data.timestamp),
        "color": color,
        "mrkdwn_in": ["text"],
        "ts": toUnixTimestamp(event.data.timestamp)
    };

    return attachment;
}

SlackHandler.prototype.sendMessage = function (message) {

    let self = this;

    if(message.projects.length > 0){
        for(var i = 0; i < message.projects.length; ++i){
            let options = {
                method: "POST",
                uri: self.projects[message.projects[i]],
                body: message,
                json: true // Automatically stringifies the body to JSON
            };
        
            rp(options)
                .then(function (parsedBody) {
                    self.emit("sent_message", message);
                    self.emit("received_reply", parsedBody);
                })
                .catch(function (error) {
                    self.emit("error", error)
                });
        }
    }
    else {
        let options = {
            method: "POST",
            uri: self.defaultWebhook,
            body: message,
            json: true // Automatically stringifies the body to JSON
        };
    
        rp(options)
            .then(function (parsedBody) {
                self.emit("sent_message", message);
                self.emit("received_reply", parsedBody);
            })
            .catch(function (error) {
                self.emit("error", error)
            });
    }

    

};

module.exports = SlackHandler;
