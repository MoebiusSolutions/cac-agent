package com.moesol.cac.agent.selector;

import static org.junit.Assert.*;

import org.junit.Test;

import com.moesol.cac.agent.jdk_interface_11.Pkcs11SystemJdk11;

public class Pkcs11SystemJdk11Test {

	@Test
	public void test() throws Exception {
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.5"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.5.0"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.6"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.6.0"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.7"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.7.0"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.8"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("1.8.0"));

		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("9-internal"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("9.0"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("9.0.1"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("10.0"));
		assertEquals(false, new Pkcs11SystemJdk11().isCompatibleWithJre("10.0.1"));

		assertEquals(true, new Pkcs11SystemJdk11().isCompatibleWithJre("11.0"));
		assertEquals(true, new Pkcs11SystemJdk11().isCompatibleWithJre("11.0.1"));
	}
}
