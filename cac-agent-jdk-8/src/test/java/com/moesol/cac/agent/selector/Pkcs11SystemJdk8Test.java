package com.moesol.cac.agent.selector;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import com.moesol.cac.agent.jdk_interface_8.Pkcs11SystemJdk8;

public class Pkcs11SystemJdk8Test {

	@Test
	public void test() throws Exception {
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("1.5.0"));
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("1.6.0"));
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("1.7.0"));

		assertEquals(true, new Pkcs11SystemJdk8().isCompatibleWithJre("1.8.0"));

		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("9.0"));
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("9.0.1"));
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("10.0"));
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("10.0.1"));
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("11.0"));
		assertEquals(false, new Pkcs11SystemJdk8().isCompatibleWithJre("11.0.1"));
	}
}
