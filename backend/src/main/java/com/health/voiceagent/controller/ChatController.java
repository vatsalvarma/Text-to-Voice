package com.health.voiceagent.controller;

import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;

import java.util.*;

@RestController
@RequestMapping("/api")
public class ChatController {

    @PostMapping("/chat")
    public Mono<Map<String, String>> chat(@RequestBody Map<String, Object> request) {
        String userMessage = (String) request.get("message");
        if (userMessage == null) userMessage = "";
        String userMessageLower = userMessage.toLowerCase();
        
        List<Map<String, String>> history = (List<Map<String, String>>) request.get("history");
        if (history == null) history = new ArrayList<>();
        
        String reply = "";
        String action = "reply";
        
        // Handle trigger words for human agent
        if (userMessageLower.contains("human") || userMessageLower.contains("agent") || 
            userMessageLower.contains("representative") || userMessageLower.contains("angry") ||
            userMessageLower.contains("manager") || userMessageLower.contains("operator")) {
            return Mono.just(Map.of("action", "transfer_call", "reply", "I completely understand. Let me transfer you to a human representative right away."));
        }

        // Determine step based on last bot message in history
        String lastBotMessage = "";
        if (!history.isEmpty()) {
            for (int i = history.size() - 1; i >= 0; i--) {
                Map<String, String> msg = history.get(i);
                if ("kate".equals(msg.get("role")) || "assistant".equals(msg.get("role"))) {
                    lastBotMessage = msg.get("content").toLowerCase();
                    break;
                }
            }
        }

        if (lastBotMessage.isEmpty()) {
            // Step 1: Introduction
            reply = "Hi, this is Kate from the appointment department at Prizmabrixx Health. Am I speaking with Sasank?";
        } else if (lastBotMessage.contains("am i speaking with sasank")) {
            // Handling response to Step 1
            if (userMessageLower.contains("no") || userMessageLower.contains("wrong") || userMessageLower.contains("incorrect")) {
                action = "end_call";
                reply = "I'm so sorry for the confusion. Have a good day. Goodbye!";
            } else if (userMessageLower.contains("not available") || userMessageLower.contains("not here") || userMessageLower.contains("later") || userMessageLower.contains("busy")) {
                action = "end_call";
                reply = "I understand. I will call back later. Goodbye!";
            } else {
                // Step 2
                reply = "Great! I'm calling to remind you that you have an annual body check coming up on Thursday, April 4th, 2024 at 10am PDT. Are you available for this appointment?";
            }
        } else if (lastBotMessage.contains("available for this appointment")) {
            // Handling response to Step 2
            if (userMessageLower.contains("no") || userMessageLower.contains("not available") || userMessageLower.contains("can't") || userMessageLower.contains("cannot") || userMessageLower.contains("reschedule")) {
                reply = "I understand. Please reschedule your appointment online at your earliest convenience. Do you have any questions for me?";
            } else {
                // Step 3
                reply = "Perfect. Before the checkup, is there anything that the doctor should know about your health?";
            }
        } else if (lastBotMessage.contains("doctor should know")) {
            // Handling response to Step 3
            if (userMessageLower.contains("yes") || userMessageLower.contains("pain") || userMessageLower.contains("hurt") || userMessageLower.contains("sick") || userMessageLower.contains("issue")) {
                reply = "I see. How long has this been going on, and how severe is it?";
            } else {
                // Step 4 & 5
                reply = "Alright, good to know. Please remember not to eat or drink anything that day before the checkup. Also, please give us a callback if there are any changes in your health condition. Do you have any questions for me?";
            }
        } else if (lastBotMessage.contains("how severe is it") || lastBotMessage.contains("how long has this been going on")) {
            // Handling response to Step 3 follow-up
            reply = "Thank you for letting me know. I will add that to your notes. Please remember not to eat or drink anything that day before the checkup. Also, please give us a callback if there are any changes in your health condition. Do you have any questions for me?";
        } else if (lastBotMessage.contains("do you have any questions for me") || lastBotMessage.contains("do you have any other questions")) {
            // Handling response to Step 5
            if (userMessageLower.contains("no") || userMessageLower.contains("none") || userMessageLower.contains("nope") || userMessageLower.contains("that's it") || userMessageLower.contains("nothing") || userMessageLower.contains("good")) {
                action = "end_call";
                reply = "Thank you, Sasank. Have a great day and we will see you soon. Goodbye!";
            } else {
                reply = "I'm sorry, I don't have the answer to that right now. Do you have any other questions?";
            }
        } else {
            // Fallback
            reply = "I didn't quite catch that. Do you have any other questions?";
        }

        return Mono.just(Map.of("action", action, "reply", reply));
    }
}
