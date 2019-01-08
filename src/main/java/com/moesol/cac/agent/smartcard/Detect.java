package com.moesol.cac.agent.smartcard;

import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.smartcardio.*;

public class Detect {
	private static Logger LOGGER = Logger.getLogger(Detect.class.getName());
	
	@SuppressWarnings("restriction")
	public static boolean anyCardPresent() {
        try {
        	TerminalFactory factory = TerminalFactory.getDefault();
			List<CardTerminal> terminals = factory.terminals().list();
			return terminals.stream()
					.filter(Detect::isCardPresent)
					.findAny().isPresent();
		} catch (CardException e) {
			LOGGER.log(Level.WARNING, "Unable to detect smart cards, assuming one inserted", e);
			return true;
		}
		
	}
	
	@SuppressWarnings("restriction")
	private static boolean isCardPresent(CardTerminal t) {
		return false;
	}

	public static void main(String[] args) throws CardException, InterruptedException {
        // show the list of available terminals
        TerminalFactory factory = TerminalFactory.getDefault();
        List<CardTerminal> terminals = factory.terminals().list();
        System.out.println("Terminals: " + terminals);

        while (true) {
        	terminals.forEach(Detect::queryTerminal);
        	Thread.sleep(1000);
        }
    }

	private static void queryTerminal(CardTerminal t) {
		try {
			System.out.printf("%s - has CARD: %s%n", t, t.isCardPresent());
		} catch (CardException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
	}

}
